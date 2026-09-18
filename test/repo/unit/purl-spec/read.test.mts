import { describe, expect, it } from 'vitest'

import { readPurlSpecSuite } from '../../../../scripts/repo/purl-spec/read.mts'

const schema = 'https://packageurl.org/schemas/purl-test.schema-0.2.json'
const baseCase = {
  description: 'valid generic package',
  test_group: 'required',
  test_type: 'parse',
  input: 'pkg:generic/widget',
  expected_output: { type: 'generic', name: 'widget' },
}

function readCase(changes: Record<string, unknown>) {
  return readPurlSpecSuite(
    { $schema: schema, tests: [{ ...baseCase, ...changes }] },
    'fixture.json',
  )
}

describe('readPurlSpecSuite', () => {
  it('accepts parse, build, and validate cases without dropping any', () => {
    expect(readCase({})).toHaveLength(1)
    expect(
      readCase({
        test_type: 'build',
        input: {
          type: 'generic',
          name: 'widget',
          qualifiers: { arch: 'arm64' },
        },
        expected_output: 'pkg:generic/widget?arch=arm64',
      }),
    ).toHaveLength(1)
    expect(
      readCase({
        test_type: 'validate',
        input: 'pkg:generic/widget',
        expected_output: 'pkg:generic/widget',
      }),
    ).toHaveLength(1)
  })

  it('accepts intentional failure cases with missing components', () => {
    expect(
      readCase({
        test_type: 'build',
        input: { type: null, name: null },
        expected_failure: true,
        expected_message: 'required components missing',
        expected_output: null,
      }),
    ).toHaveLength(1)
  })

  it.each([
    null,
    {},
    { $schema: schema, tests: [] },
    { $schema: schema, tests: [null] },
    { $schema: 'unknown', tests: [baseCase] },
  ])('rejects malformed suite %#', value => {
    expect(() => readPurlSpecSuite(value, 'fixture.json')).toThrow()
  })

  it.each([
    { description: '' },
    { expected_failure: true, expected_output: null },
    { expected_failure: 'false' },
    { test_group: 'unknown' },
    { test_type: 'unknown' },
    { input: null },
    { expected_output: undefined },
    { expected_output: { type: false } },
    { expected_output: { qualifiers: { arch: 1 } } },
    { expected_output: { unknown: 'value' } },
    { test_type: 'build', input: 'pkg:generic/widget' },
    { test_type: 'validate', expected_output: {} },
  ])('rejects malformed case %#', changes => {
    expect(() => readCase(changes)).toThrow()
  })

  it('keeps repo-owned roundtrip cases separate from upstream schema', () => {
    const suite = {
      $schema: 'https://packageurl.org/schemas/purl-test.schema-1.0.json',
      tests: [
        {
          ...baseCase,
          test_type: 'roundtrip',
          test_group: 'base',
          expected_output: 'pkg:generic/widget',
        },
      ],
    }
    expect(readPurlSpecSuite(suite, 'contrib.json')).toHaveLength(1)
  })
})

describe('published schema groups', () => {
  it.each(['0.1', '1.0'])(
    'maps schema %s base and advanced groups without dropping cases',
    version => {
      const tests = ['base', 'advanced'].map(test_group => ({
        ...baseCase,
        test_group,
        test_type: 'roundtrip',
        expected_output: baseCase.input,
      }))
      const result = readPurlSpecSuite(
        {
          $schema: `https://packageurl.org/schemas/purl-test.schema-${version}.json`,
          tests,
        },
        'fixture.json',
      )
      expect(result.map(test => test.test_group)).toEqual([
        'required',
        'recommended',
      ])
    },
  )
})
