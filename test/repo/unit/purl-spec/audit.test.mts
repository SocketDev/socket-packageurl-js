import { describe, expect, it } from 'vitest'

import { PackageURL } from '../../../../src/package-url.mjs'
import { auditPurlCases } from '../../../../scripts/repo/purl-spec/audit.mts'
import type { PurlSpecCase } from '../../../../scripts/repo/purl-spec/load.mts'

const entry: PurlSpecCase = {
  source: 'spec/fixture.json',
  index: 0,
  test: {
    description: 'generic identity',
    expected_failure: false,
    expected_output: 'pkg:generic/widget',
    input: 'pkg:generic/widget',
    test_group: 'required',
    test_type: 'roundtrip',
  },
}

describe('auditPurlCases', () => {
  it('reports raw differences and counts every evaluated case', () => {
    const mismatch = {
      ...entry,
      index: 1,
      test: { ...entry.test, expected_output: 'pkg:generic/other' },
    }
    expect(auditPurlCases([entry, mismatch], PackageURL)).toMatchObject({
      total: 2,
      passed: 1,
      differences: [
        {
          source: entry.source,
          index: 1,
          result: {
            passed: false,
            actual: 'pkg:generic/widget',
            expected: 'pkg:generic/other',
          },
        },
      ],
    })
  })
})
