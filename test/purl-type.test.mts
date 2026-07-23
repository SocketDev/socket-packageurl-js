/**
 * @file Tests for purl-type.mts — PurlTypeValidator, PurlType, and related
 *   utilities.
 */
import { describe, expect, it } from 'vitest'

import { PurlError } from '../src/error.mjs'
import { PurlType, PurlTypeValidator } from '../src/purl-type.mjs'
import type { PurlObject } from '../src/purl-type.mjs'

type PurlTypeHelpers = Record<
  string,
  {
    readonly validate: (
      purl: PurlObject,
      options?: { throws?: boolean | undefined } | undefined,
    ) => boolean
    readonly normalize: (purl: PurlObject) => PurlObject
  }
>
const PurlTypeT = PurlType as unknown as PurlTypeHelpers

describe('purl-type.mts — PurlTypeValidator default options', () => {
  it('defaults to {} and returns true when called without an options argument', () => {
    expect(PurlTypeValidator({ name: 'safe-name' })).toBe(true)
  })
})

describe('purl-type edge cases', () => {
  it('accepts fallback types when type and namespace are undefined', () => {
    expect(
      PurlTypeT['alpm'].validate({ name: 'pacman' }, { throws: false }),
    ).toBe(true)
  })
})

describe('maven namespace slash validation', () => {
  it('returns false (non-throwing) when maven namespace contains a slash', () => {
    expect(
      PurlTypeT['maven'].validate(
        {
          type: 'maven',
          namespace: 'org.apache/commons',
          name: 'commons-lang3',
          version: '3.12.0',
          qualifiers: undefined,
          subpath: undefined,
        },
        { throws: false },
      ),
    ).toBe(false)
  })

  it('throws PurlError when validating maven namespace with slash directly', () => {
    expect(() =>
      PurlTypeT['maven'].validate(
        {
          type: 'maven',
          namespace: 'org.apache/commons',
          name: 'commons-lang3',
          version: '3.12.0',
          qualifiers: undefined,
          subpath: undefined,
        },
        { throws: true },
      ),
    ).toThrow(PurlError)
  })
})
