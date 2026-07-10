/**
 * @file Unit tests for bazel.mts — validate and related utilities.
 */
import { describe, expect, it } from 'vitest'

import { PackageURL } from '../src/package-url.mjs'
import { validate as validateBazel } from '../src/purl-types/bazel.mjs'

describe('bazel', () => {
  it('should require version for bazel packages', () => {
    expect(() => {
      return new PackageURL(
        'bazel',
        undefined,
        'rules_go',
        undefined,
        undefined,
        undefined,
      )
    }).toThrow('bazel requires a "version" component')
  })

  it('should accept bazel packages with version', () => {
    const purl = new PackageURL(
      'bazel',
      undefined,
      'rules_go',
      '0.41.0',
      undefined,
      undefined,
    )
    expect(purl.toString()).toBe('pkg:bazel/rules_go@0.41.0')
  })

  it('should preserve bazel package name case', () => {
    // A Bazel module name is case-sensitive and already lowercase by Bazel's
    // own VALID_MODULE_NAME grammar; lowercasing here would mask an invalid
    // name. Matches the canonical purl-spec fixture pkg:bazel/Curl@8.8.0.bcr.1.
    const purl = new PackageURL(
      'bazel',
      undefined,
      'Curl',
      '8.8.0.bcr.1',
      undefined,
      undefined,
    )
    expect(purl.name).toBe('Curl')
    expect(purl.toString()).toBe('pkg:bazel/Curl@8.8.0.bcr.1')
  })

  it('should return false when validation fails without throws', () => {
    const invalidPurl = { name: 'rules_go', type: 'bazel' }
    expect(validateBazel(invalidPurl, { throws: false })).toBe(false)
  })
})
