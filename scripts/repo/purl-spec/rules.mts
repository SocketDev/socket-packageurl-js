import crypto from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'

import { isPlainObject } from '@socketsecurity/lib-stable/objects/predicates'

import { readPurlSpecSuite } from './read.mts'
import type { SpecTest } from './read.mts'
import type { PurlSpecCase } from './load.mts'

export interface PurlRuleCorrection {
  source: string
  fingerprint: string
  expected_output: SpecTest['expected_output']
  provenance: { urls: string[]; reviewed: string; rule: string }
}

export function fingerprintPurlCase(test: SpecTest): string {
  return crypto.createHash('sha256').update(JSON.stringify(test)).digest('hex')
}

function isPurlRuleUrl(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith('https://github.com/package-url/purl-spec/')
  )
}

export function readPurlRuleCorrections(value: unknown): PurlRuleCorrection[] {
  if (!Array.isArray(value)) {
    throw new Error('PURL rule corrections must be an array.')
  }
  return value.map((item: unknown) => {
    if (
      !isPlainObject(item) ||
      typeof item['source'] !== 'string' ||
      typeof item['fingerprint'] !== 'string' ||
      !/^[a-f0-9]{64}$/.test(item['fingerprint'])
    ) {
      throw new Error(
        'PURL rule correction requires a source and SHA-256 fingerprint.',
      )
    }
    const provenance = item['provenance']
    if (
      !isPlainObject(provenance) ||
      !Array.isArray(provenance['urls']) ||
      !provenance['urls'].length ||
      !provenance['urls'].every(isPurlRuleUrl) ||
      typeof provenance['reviewed'] !== 'string' ||
      !Number.isFinite(Date.parse(provenance['reviewed'])) ||
      typeof provenance['rule'] !== 'string' ||
      !provenance['rule']
    ) {
      throw new Error(
        'PURL rule correction requires an upstream rule URL, review date, and rationale.',
      )
    }
    return item as unknown as PurlRuleCorrection
  })
}

export function applyPurlRuleCorrections(
  cases: PurlSpecCase[],
  corrections: PurlRuleCorrection[],
): PurlSpecCase[] {
  const counts = new Map<PurlRuleCorrection, number>()
  const updated = cases.map(entry => {
    const fingerprint = fingerprintPurlCase(entry.test)
    const matches = corrections.filter(
      correction =>
        correction.source === entry.source &&
        correction.fingerprint === fingerprint,
    )
    if (matches.length > 1) {
      throw new Error(`Duplicate PURL rule corrections for ${entry.source}.`)
    }
    const correction = matches[0]
    if (!correction) {
      return entry
    }
    if (
      isDeepStrictEqual(correction.expected_output, entry.test.expected_output)
    ) {
      throw new Error(
        `Obsolete PURL rule correction for ${entry.source}; the upstream expectation already matches.`,
      )
    }
    counts.set(correction, (counts.get(correction) ?? 0) + 1)
    const test = { ...entry.test, expected_output: correction.expected_output }
    readPurlSpecSuite(
      {
        $schema: 'https://packageurl.org/schemas/purl-test.schema-0.2.json',
        tests: [
          {
            ...test,
            test_type:
              test.test_type === 'roundtrip' ? 'validate' : test.test_type,
          },
        ],
      },
      entry.source,
    )
    return { __proto__: null, ...entry, test }
  })
  for (let index = 0, { length } = corrections; index < length; index += 1) {
    const correction = corrections[index]!
    if (counts.get(correction) !== 1) {
      throw new Error(
        `Stale or ambiguous PURL rule correction for ${correction.source}; review the upstream rule and fixture.`,
      )
    }
  }
  return updated
}
