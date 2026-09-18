/**
 * @file Property/fuzz tests for src/encode (Tier-1 fast-check).
 *   The encoders turn a raw PURL component into its percent-encoded canonical
 *   form. The decode∘encode round-trip properties live in
 *   test/decode-fuzz.test.mts. There the decoder is the unit under test.
 *   Load-bearing properties:
 *
 *   - INVARIANT: a blank/empty component always encodes to the empty string.
 *   - INVARIANT: `encodeQualifiers` emits keys in sorted order and returns '' for
 *     non-object input.
 *   - Qualifier encoding preserves spaces, plus signs, and percent escapes.
 */

import fc from 'fast-check'
import { describe, expect, test } from 'vitest'

import {
  encodeName,
  encodeNamespace,
  encodeQualifiers,
  encodeSubpath,
  encodeVersion,
} from '../src/encode.mjs'

describe('encode — fuzz', () => {
  // INVARIANT (classical #1): a whitespace/empty component is treated as
  // non-empty by isNonEmptyString only when length > 0, but the empty string
  // itself always encodes to ''.
  test('empty string encodes to empty for every component encoder', () => {
    for (const enc of [
      encodeName,
      encodeVersion,
      encodeNamespace,
      encodeSubpath,
    ]) {
      expect(enc('')).toBe('')
    }
  })

  // INVARIANT (classical #1): encodeQualifiers emits keys in ascending sorted
  // order. Keys are drawn from a safe lowercase alphabet so they survive
  // encoding verbatim and can be read back off the query string.
  test('encodeQualifiers emits keys in sorted order', () => {
    const key = fc
      .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'), {
        minLength: 1,
        maxLength: 8,
      })
      .map(chars => chars.join(''))
    // Values are safe alnum so they never contain '=' or '&' after encoding,
    // keeping the emitted `key=value&...` splittable.
    const value = fc
      .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'), {
        minLength: 1,
        maxLength: 8,
      })
      .map(chars => chars.join(''))
    fc.assert(
      fc.property(
        fc.dictionary(key, value, { minKeys: 1, maxKeys: 6 }),
        dict => {
          const encoded = encodeQualifiers(dict)
          const emittedKeys = encoded
            .split('&')
            .map(pair => pair.slice(0, pair.indexOf('=')))
          const expectedOrder = [...emittedKeys].toSorted()
          expect(emittedKeys).toEqual(expectedOrder)
          // Every input key is present exactly once.
          expect([...emittedKeys].toSorted()).toEqual(
            Object.keys(dict).toSorted(),
          )
        },
      ),
    )
  })

  // INVARIANT: encodeQualifiers of a non-object is the empty string.
  test('encodeQualifiers returns empty string for non-object input', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string(),
          fc.integer(),
          fc.boolean(),
          fc.constant(undefined),
        ),
        v => {
          expect(encodeQualifiers(v)).toBe('')
        },
      ),
    )
  })

  test('qualifier values survive percent encoding without collisions', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme' }), value => {
        const encoded = encodeQualifiers({ value })
        expect(new URLSearchParams(encoded).get('value')).toBe(value)
      }),
    )
  })
})
