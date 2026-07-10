/**
 * @file Tests for encode.mts — encodeQualifiers and related utilities.
 */
import { describe, expect, it } from 'vitest'

import { encodeQualifiers } from '../src/encode.mjs'
import { PackageURL } from '../src/package-url.mjs'

describe('encode edge cases', () => {
  it('toString returns no qualifiers segment when qualifiers are null', () => {
    const purl = new PackageURL(
      'npm',
      undefined,
      'lodash',
      '1.0.0',
      undefined,
      undefined,
    )
    const str = purl.toString()
    expect(str).not.toContain('?')
  })
})

describe('encodeQualifiers edge case', () => {
  it('returns empty string for non-object input', () => {
    const result = encodeQualifiers(undefined)
    expect(result).toBe('')
  })
})
