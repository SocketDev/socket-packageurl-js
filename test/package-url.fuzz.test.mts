/**
 * @file Property/fuzz tests for the PURL parser + serializer (Tier-1
 *   fast-check). `PackageURL.fromString` is the library's UNTRUSTED-input
 *   parser; `toString`/`toObject` are its serializers. Load-bearing properties:
 *
 *   - ROUND-TRIP: fromString(purl.toString()).toString() === purl.toString()
 *     (parse ∘ stringify is the identity on canonical strings).
 *   - IDEMPOTENCE: canonicalizing a canonical string is a no-op; toString is
 *     stable.
 *   - ROUND-TRIP: fromObject(purl.toObject()) reproduces the same canonical
 *     string.
 *   - NEVER-THROWS: isValid / tryFromString / tryParseString tolerate ANY input
 *     and return a boolean / Result — they never leak a raw throw. PackageURL
 *     instances are CONSTRUCTED from a safe alphabet so the constructor always
 *     succeeds; the canonical string is compared to itself (never a
 *     reimplementation of the spec serialization).
 */

import fc from 'fast-check'
import { describe, expect, test } from 'vitest'

import { PackageURL } from '../src/package-url.mjs'

const LOWER = 'abcdefghijklmnopqrstuvwxyz'
const ALNUM = `${LOWER}0123456789`

// Safe word starting with a letter (valid name/namespace for lenient types).
const word = fc
  .tuple(
    fc.constantFrom(...LOWER),
    fc.array(fc.constantFrom(...ALNUM, '-'), { maxLength: 8 }),
  )
  .map(([head, rest]) => head + rest.join(''))

const versionArb = fc
  .array(fc.constantFrom(...ALNUM, '.', '-'), { minLength: 1, maxLength: 8 })
  .map(chars => chars.join(''))

// Qualifier keys/values from a safe alphabet (keys already lowercase, so
// normalization is stable under the round-trip).
const qualKey = fc
  .tuple(
    fc.constantFrom(...LOWER),
    fc.array(fc.constantFrom(...ALNUM, '_'), { maxLength: 6 }),
  )
  .map(([head, rest]) => head + rest.join(''))
const qualValue = fc
  .array(fc.constantFrom(...ALNUM, '.', '-'), { minLength: 1, maxLength: 8 })
  .map(chars => chars.join(''))

// Subpath: clean segments (never '.'/'..'/blank) joined by '/'.
const subpathArb = fc
  .array(word, { minLength: 1, maxLength: 3 })
  .map(segs => segs.join('/'))

// Lenient registered types whose normalization is a no-op (or lowercasing,
// which our lowercase alphabet already satisfies) — so construction succeeds
// for every generated tuple. Namespace rules differ per type (npm needs an
// '@'-prefix, gem/pypi require it empty), so a namespace is only attached to
// `generic`, which imposes no namespace constraint; the other types still
// exercise their own name/version normalization paths.
const typeArb = fc.constantFrom('generic', 'npm', 'gem', 'pypi')

// A constructed, always-valid PackageURL.
const purlArb: fc.Arbitrary<PackageURL> = typeArb.chain(type => {
  const namespaceArb =
    type === 'generic'
      ? fc.option(word, { nil: undefined })
      : fc.constant(undefined)
  return fc
    .record({
      namespace: namespaceArb,
      name: word,
      version: fc.option(versionArb, { nil: undefined }),
      qualifiers: fc.option(
        fc.dictionary(qualKey, qualValue, { minKeys: 1, maxKeys: 4 }),
        { nil: undefined },
      ),
      subpath: fc.option(subpathArb, { nil: undefined }),
    })
    .map(
      ({ namespace, name, version, qualifiers, subpath }) =>
        new PackageURL(type, namespace, name, version, qualifiers, subpath),
    )
})

describe('PackageURL parse/stringify — fuzz', () => {
  // ROUND-TRIP (classical #4): parse ∘ stringify is the identity on the
  // canonical string.
  test('fromString(toString()) round-trips the canonical string', () => {
    fc.assert(
      fc.property(purlArb, purl => {
        const canonical = purl.toString()
        const reparsed = PackageURL.fromString(canonical)
        expect(reparsed.toString()).toBe(canonical)
      }),
    )
  })

  // IDEMPOTENCE (classical #3): canonicalizing an already-canonical string is a
  // no-op, and toString is a stable value.
  test('canonicalization is idempotent and toString is stable', () => {
    fc.assert(
      fc.property(purlArb, purl => {
        const s1 = purl.toString()
        const s2 = purl.toString()
        expect(s2).toBe(s1)
        const s3 = PackageURL.fromString(PackageURL.fromString(s1).toString())
        expect(s3.toString()).toBe(s1)
      }),
    )
  })

  // ROUND-TRIP: fromObject(toObject()) reproduces the same canonical string.
  test('fromObject(toObject()) reproduces the canonical string', () => {
    fc.assert(
      fc.property(purlArb, purl => {
        const rebuilt = PackageURL.fromObject(purl.toObject())
        expect(rebuilt.toString()).toBe(purl.toString())
      }),
    )
  })

  // ROUND-TRIP: a constructed purl's canonical string is accepted by isValid.
  test('isValid accepts every constructed canonical string', () => {
    fc.assert(
      fc.property(purlArb, purl => {
        expect(PackageURL.isValid(purl.toString())).toBe(true)
      }),
    )
  })

  // The wither methods produce valid purls whose canonical string round-trips.
  // withNamespace targets a generic purl (the only type here with no namespace
  // constraint); withVersion/withSubpath apply to any constructed purl.
  test('withVersion / withNamespace / withSubpath yield round-trippable purls', () => {
    const genericPurl = new PackageURL(
      'generic',
      undefined,
      'pkg',
      '1.0.0',
      undefined,
      undefined,
    )
    fc.assert(
      fc.property(purlArb, versionArb, word, subpathArb, (purl, v, ns, sp) => {
        for (const next of [
          purl.withVersion(v),
          genericPurl.withNamespace(ns),
          purl.withSubpath(sp),
        ]) {
          const canonical = next.toString()
          expect(PackageURL.fromString(canonical).toString()).toBe(canonical)
        }
      }),
    )
  })

  // NEVER-THROWS: isValid tolerates ANY input and returns a boolean.
  test('isValid never throws on arbitrary input', () => {
    const purlSoup = fc
      .array(
        fc.constantFrom(
          'pkg:',
          'npm/',
          'generic/',
          '@',
          '/',
          '?',
          '#',
          '=',
          '&',
          'a',
          '1',
          '%',
          '://',
          ':',
        ),
        { maxLength: 20 },
      )
      .map(parts => parts.join(''))
    fc.assert(
      fc.property(fc.oneof(fc.string(), purlSoup), s => {
        let threw = false
        let result: unknown
        try {
          result = PackageURL.isValid(s)
        } catch {
          threw = true
        }
        expect(threw).toBe(false)
        expect(typeof result).toBe('boolean')
      }),
    )
  })

  // NEVER-THROWS: tryFromString / tryParseString return a Result for any input
  // (the throwing fromString/parseString are wrapped).
  test('tryFromString and tryParseString never throw and return a Result', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.anything()), input => {
        let threw = false
        try {
          const r1 = PackageURL.tryFromString(input)
          const r2 = PackageURL.tryParseString(input)
          expect(typeof r1.isOk()).toBe('boolean')
          expect(typeof r2.isOk()).toBe('boolean')
          // Exactly one of ok/err holds.
          expect(r1.isOk()).toBe(!r1.isErr())
        } catch {
          threw = true
        }
        expect(threw).toBe(false)
      }),
    )
  })

  // ROUND-TRIP consistency: an equal-by-construction pair (a purl vs. a fresh
  // parse of its own canonical string) is reported equal.
  test('a purl equals a fresh parse of its own canonical string', () => {
    fc.assert(
      fc.property(purlArb, purl => {
        const canonical = purl.toString()
        const reparsed = PackageURL.fromString(canonical)
        expect(purl.equals(reparsed)).toBe(true)
        expect(purl.compare(reparsed)).toBe(0)
      }),
    )
  })
})
