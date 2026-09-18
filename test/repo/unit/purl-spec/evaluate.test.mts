import { afterEach, describe, expect, it, vi } from 'vitest'

import { PackageURL } from '../../../../src/package-url.mjs'
import { evaluatePurlCase } from '../../../../scripts/repo/purl-spec/evaluate.mts'
import type { SpecTest } from '../../../../scripts/repo/purl-spec/read.mts'

const baseCase: SpecTest = {
  description: 'generic identity',
  expected_failure: false,
  expected_output: 'pkg:generic/widget',
  input: 'pkg:generic/widget',
  test_group: 'required',
  test_type: 'roundtrip',
}

afterEach(() => vi.restoreAllMocks())

describe('evaluatePurlCase', () => {
  it('compares exact strings and component objects', () => {
    expect(evaluatePurlCase(baseCase, PackageURL).passed).toBe(true)
    expect(
      evaluatePurlCase(
        {
          ...baseCase,
          test_type: 'parse',
          expected_output: { type: 'generic', name: 'widget' },
        },
        PackageURL,
      ).passed,
    ).toBe(true)
    expect(
      evaluatePurlCase(
        {
          ...baseCase,
          test_type: 'build',
          input: { type: 'generic', name: 'widget' },
        },
        PackageURL,
      ).passed,
    ).toBe(true)
  })

  it('reports serialization differences without suppressing them', () => {
    expect(
      evaluatePurlCase(
        { ...baseCase, expected_output: 'pkg:generic/other' },
        PackageURL,
      ),
    ).toMatchObject({
      passed: false,
      actual: 'pkg:generic/widget',
      expected: 'pkg:generic/other',
    })
  })

  it('distinguishes expected and unexpected constructor failures', () => {
    expect(
      evaluatePurlCase(
        { ...baseCase, input: 'invalid', expected_failure: true },
        PackageURL,
      ).passed,
    ).toBe(true)
    expect(
      evaluatePurlCase({ ...baseCase, input: 'invalid' }, PackageURL).passed,
    ).toBe(false)
    expect(
      evaluatePurlCase({ ...baseCase, expected_failure: true }, PackageURL)
        .passed,
    ).toBe(false)
  })

  it('records serializer failures so auditing can continue with later cases', () => {
    vi.spyOn(PackageURL.prototype, 'toString').mockImplementation(() => {
      throw new TypeError('fixture serialization failed')
    })
    expect(evaluatePurlCase(baseCase, PackageURL).passed).toBe(false)
    expect(
      evaluatePurlCase({ ...baseCase, expected_failure: true }, PackageURL)
        .passed,
    ).toBe(true)
    expect(
      evaluatePurlCase(
        { ...baseCase, test_type: 'parse', expected_failure: true },
        PackageURL,
      ).passed,
    ).toBe(false)
  })
})
