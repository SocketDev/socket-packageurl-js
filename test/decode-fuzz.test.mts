/**
 * @file Property/fuzz tests for src/decode (Tier-1 fast-check).
 *   `decodePurlComponent` reverses the component encoders in src/encode — the
 *   encode/decode pair is what makes parse ↔ stringify lossless. The encoders
 *   are imported only to CONSTRUCT canonical inputs; the unit under test is the
 *   decoder. Load-bearing properties:
 *
 *   - ROUND-TRIP: decoding an encoded component recovers the original text for
 *     every component kind (name, version, namespace, subpath).
 *   - INVARIANT: spaces are percent-escaped, never dropped — a space-only value
 *     survives the round-trip. Arbitraries are built from graphemes
 *     (fc.string({ unit: 'grapheme' })) so no lone surrogate reaches
 *     encodeURIComponent — that would throw a platform "URI malformed", a JS
 *     behavior unrelated to the SUT contract.
 */

import fc from 'fast-check'
import { describe, expect, test } from 'vitest'

import { decodePurlComponent } from '../src/decode.mjs'
import {
  encodeName,
  encodeNamespace,
  encodeSubpath,
  encodeVersion,
} from '../src/encode.mjs'

// Any well-formed string (no lone surrogates). No length cap — let fast-check
// explore long inputs.
const text = fc.string({ unit: 'grapheme' })

// A run of whitespace-only characters that `isNonEmptyString` still treats as
// non-empty (length > 0) but that carry no encodable payload beyond spaces.
const spaces = fc
  .array(fc.constantFrom(' ', '\t'), { minLength: 1, maxLength: 8 })
  .map(chars => chars.join(''))

describe('decode — fuzz', () => {
  // ROUND-TRIP (classical #4): decode∘encode is the identity for names.
  test('decodePurlComponent reverses encodeName', () => {
    fc.assert(
      fc.property(text, s => {
        expect(decodePurlComponent('name', encodeName(s))).toBe(s)
      }),
    )
  })

  // ROUND-TRIP: decode∘encode is the identity for versions.
  test('decodePurlComponent reverses encodeVersion', () => {
    fc.assert(
      fc.property(text, s => {
        expect(decodePurlComponent('version', encodeVersion(s))).toBe(s)
      }),
    )
  })

  // ROUND-TRIP: decode∘encode is the identity for namespaces (which also
  // restore the '/' segment separator).
  test('decodePurlComponent reverses encodeNamespace', () => {
    fc.assert(
      fc.property(text, s => {
        expect(decodePurlComponent('namespace', encodeNamespace(s))).toBe(s)
      }),
    )
  })

  // ROUND-TRIP: decode∘encode is the identity for subpaths (which restore both
  // '/' and ':').
  test('decodePurlComponent reverses encodeSubpath', () => {
    fc.assert(
      fc.property(text, s => {
        expect(decodePurlComponent('subpath', encodeSubpath(s))).toBe(s)
      }),
    )
  })

  // INVARIANT: a space-only value never round-trips to a bare space via the
  // encoders (spaces are percent-escaped, never dropped) — decoding recovers it.
  test('space-only components round-trip through encodeName', () => {
    fc.assert(
      fc.property(spaces, s => {
        expect(decodePurlComponent('name', encodeName(s))).toBe(s)
      }),
    )
  })
})
