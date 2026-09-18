import { afterEach, describe, expect, it, vi } from 'vitest'

import { PackageURL } from '../../../../src/package-url.mjs'
import { evaluatePurlCase } from '../../../../scripts/repo/purl-spec/evaluate.mts'
import {
  applyPurlRuleCorrections,
  fingerprintPurlCase,
  readPurlRuleCorrections,
} from '../../../../scripts/repo/purl-spec/rules.mts'
import type { PurlSpecCase } from '../../../../scripts/repo/purl-spec/load.mts'
import type { PurlRuleCorrection } from '../../../../scripts/repo/purl-spec/rules.mts'

const entry: PurlSpecCase = {
  source: 'types/git-test.json',
  index: 0,
  test: {
    description: 'case-sensitive git identity',
    expected_failure: false,
    expected_output: 'pkg:git/github.com/acme/widget',
    input: 'pkg:git/github.com/Acme/Widget',
    test_group: 'recommended',
    test_type: 'roundtrip',
  },
}
const correction: PurlRuleCorrection = {
  source: entry.source,
  fingerprint: fingerprintPurlCase(entry.test),
  expected_output: entry.test.input,
  provenance: {
    urls: [
      'https://github.com/package-url/purl-spec/blob/main/types/git-definition.json',
    ],
    reviewed: '2026-09-18',
    rule: 'Git identity preserves case.',
  },
}

afterEach(() => vi.restoreAllMocks())

describe('applyPurlRuleCorrections', () => {
  it('tests the rule while preserving the original fixture', () => {
    const corrected = applyPurlRuleCorrections([entry], [correction])
    expect(evaluatePurlCase(entry.test, PackageURL).passed).toBe(false)
    expect(evaluatePurlCase(corrected[0]!.test, PackageURL).passed).toBe(true)
    expect(entry.test.expected_output).toBe('pkg:git/github.com/acme/widget')
  })

  it('still detects a runtime regression after applying the rule', () => {
    const corrected = applyPurlRuleCorrections([entry], [correction])
    vi.spyOn(PackageURL.prototype, 'toString').mockReturnValue(
      'pkg:git/github.com/acme/widget',
    )
    expect(evaluatePurlCase(corrected[0]!.test, PackageURL).passed).toBe(false)
  })

  it('rejects stale, duplicate, and ambiguous corrections', () => {
    expect(() => applyPurlRuleCorrections([], [correction])).toThrow()
    expect(() =>
      applyPurlRuleCorrections(
        [
          {
            ...entry,
            test: { ...entry.test, input: 'pkg:git/example.com/changed' },
          },
        ],
        [correction],
      ),
    ).toThrow()
    expect(() =>
      applyPurlRuleCorrections([entry], [correction, correction]),
    ).toThrow()
    expect(() =>
      applyPurlRuleCorrections([entry, entry], [correction]),
    ).toThrow()
  })

  it('rejects corrections that no longer change an upstream expectation', () => {
    expect(() =>
      applyPurlRuleCorrections(
        [entry],
        [{ ...correction, expected_output: entry.test.expected_output }],
      ),
    ).toThrow()
  })

  it('preserves cases without a matching correction', () => {
    expect(applyPurlRuleCorrections([entry], [])).toEqual([entry])
  })
})

describe('readPurlRuleCorrections', () => {
  it('requires exact fixture identity and upstream provenance', () => {
    expect(readPurlRuleCorrections([correction])).toEqual([correction])
    expect(() => readPurlRuleCorrections({})).toThrow()
    expect(() =>
      readPurlRuleCorrections([{ ...correction, fingerprint: 'invalid' }]),
    ).toThrow()
    expect(() =>
      readPurlRuleCorrections([{ ...correction, provenance: {} }]),
    ).toThrow()
  })
})
