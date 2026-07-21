/**
 * @file Property/fuzz tests for src/normalize (Tier-1 fast-check).
 *   The normalizers put a raw PURL component into canonical form. Load-bearing
 *   properties:
 *
 *   - INVARIANT: normalizePurlPath output has no leading/trailing '/', and no
 *     empty segments (never a '//').
 *   - IDEMPOTENCE: normalizing an already-normalized value is a no-op.
 *   - ORACLE (constructed): a path built by joining slash-free non-empty segments
 *     with single '/' normalizes back to exactly those segments.
 *   - RESTRICTED-INPUT: normalizeSubpath drops '.' / '..' / blank segments.
 *   - INVARIANT: normalizeType output equals its own lowercase and is trimmed;
 *     normalizeQualifiers never throws and lowercases all keys.
 */

import fc from 'fast-check'
import { describe, expect, test } from 'vitest'

import {
  normalizeName,
  normalizePurlPath,
  normalizeQualifiers,
  normalizeSubpath,
  normalizeType,
  normalizeVersion,
} from '../src/normalize.mjs'

// A non-empty segment that contains no '/' and is not pure whitespace — the
// unit a normalized path is built from. Starts with an alnum char so it is
// never blank and never a bare '.'/'..'.
const ALNUM = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const segment = fc
  .tuple(
    fc.constantFrom(...ALNUM),
    fc.array(fc.constantFrom(...ALNUM, '-', '_', '.'), { maxLength: 10 }),
  )
  .map(([head, rest]) => head + rest.join(''))

const segments = fc.array(segment, { minLength: 1, maxLength: 8 })

// A run of slashes to splice between/around segments (collapsible noise).
const slashes = fc
  .array(fc.constant('/'), { minLength: 1, maxLength: 4 })
  .map(s => s.join(''))

describe('normalize — fuzz', () => {
  // INVARIANT (classical #1): normalized path never has leading/trailing '/'
  // and never a '//' (empty segment). Holds for ANY input string.
  test('normalizePurlPath output has no boundary or empty slashes', () => {
    fc.assert(
      fc.property(fc.string(), s => {
        const out = normalizePurlPath(s)
        if (out.length > 0) {
          expect(out.startsWith('/')).toBe(false)
          expect(out.endsWith('/')).toBe(false)
        }
        expect(out.includes('//')).toBe(false)
      }),
    )
  })

  // IDEMPOTENCE (classical #3): normalizing an already-normalized path is a
  // no-op.
  test('normalizePurlPath is idempotent', () => {
    fc.assert(
      fc.property(fc.string(), s => {
        const once = normalizePurlPath(s)
        expect(normalizePurlPath(once)).toBe(once)
      }),
    )
  })

  // ORACLE (classical #5, constructed): slash-free non-empty segments joined by
  // single '/' come back unchanged.
  test('normalizePurlPath preserves clean segment joins', () => {
    fc.assert(
      fc.property(segments, segs => {
        expect(normalizePurlPath(segs.join('/'))).toBe(segs.join('/'))
      }),
    )
  })

  // DERIVED (classical #2): surrounding + interior slash runs collapse to the
  // clean join — leading/trailing/duplicated slashes are insignificant.
  test('normalizePurlPath collapses arbitrary slash noise', () => {
    fc.assert(
      fc.property(segments, slashes, slashes, (segs, lead, tail) => {
        const noisy = `${lead}${segs.join('//')}${tail}`
        expect(normalizePurlPath(noisy)).toBe(segs.join('/'))
      }),
    )
  })

  // RESTRICTED-INPUT: normalizeSubpath output never contains a '.' or '..'
  // segment (they are filtered) and never a blank one.
  test('normalizeSubpath drops dot and blank segments', () => {
    // Mix good segments with dot/dotdot/blank noise; only the good ones survive.
    const noise = fc.constantFrom('.', '..', '', '   ')
    const mixed = fc.array(fc.oneof(segment, noise), { maxLength: 12 })
    fc.assert(
      fc.property(mixed, parts => {
        const out = normalizeSubpath(parts.join('/'))
        const outSegs = (out ?? '').split('/')
        for (let i = 0, { length } = outSegs; i < length; i += 1) {
          const seg = outSegs[i]!
          if (seg.length === 0) {
            continue
          }
          expect(seg).not.toBe('.')
          expect(seg).not.toBe('..')
        }
      }),
    )
  })

  // ORACLE (constructed): a subpath of purely clean segments survives intact.
  test('normalizeSubpath preserves clean segment joins', () => {
    fc.assert(
      fc.property(segments, segs => {
        expect(normalizeSubpath(segs.join('/'))).toBe(segs.join('/'))
      }),
    )
  })

  // A subpath made only of dot/blank noise normalizes to the empty string.
  test('normalizeSubpath of only dot/blank segments is empty', () => {
    const noiseOnly = fc
      .array(fc.constantFrom('.', '..', '', '/'), {
        minLength: 1,
        maxLength: 8,
      })
      .map(a => a.join('/'))
    fc.assert(
      fc.property(noiseOnly, s => {
        expect(normalizeSubpath(s)).toBe('')
      }),
    )
  })

  // INVARIANT + IDEMPOTENCE: normalizeType output equals its own lowercase, has
  // no leading/trailing ASCII whitespace, and is idempotent. (Characteristics,
  // not a reimplementation of the exact transform.)
  test('normalizeType lowercases, trims, and is idempotent', () => {
    fc.assert(
      fc.property(fc.string(), s => {
        const out = normalizeType(s)
        if (out === undefined) {
          return
        }
        expect(out).toBe(out.toLowerCase())
        expect(out).toBe(out.trim())
        expect(normalizeType(out)).toBe(out)
      }),
    )
  })

  // INVARIANT: normalizeName/normalizeVersion are pure trims — idempotent, and
  // undefined only for non-string input.
  test('normalizeName and normalizeVersion trim and are idempotent', () => {
    fc.assert(
      fc.property(fc.string(), s => {
        const n = normalizeName(s)
        const v = normalizeVersion(s)
        expect(n).toBe(s.trim())
        expect(v).toBe(s.trim())
        expect(normalizeName(n)).toBe(n)
      }),
    )
  })

  // INVARIANT + NEVER-THROWS: normalizeQualifiers never throws on an arbitrary
  // string-keyed dictionary, all output keys are lowercase, and no output value
  // is empty (empty-after-trim pairs are dropped).
  test('normalizeQualifiers never throws and lowercases keys', () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), fc.string()), dict => {
        let out: Record<string, string> | undefined
        let threw = false
        try {
          out = normalizeQualifiers(dict)
        } catch {
          threw = true
        }
        expect(threw).toBe(false)
        if (out) {
          const keys = Object.keys(out)
          for (let i = 0, { length } = keys; i < length; i += 1) {
            const key = keys[i]!
            expect(key).toBe(key.toLowerCase())
            expect(out[key]!.length).toBeGreaterThan(0)
          }
        }
      }),
    )
  })
})
