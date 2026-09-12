import { describe, expect, it } from 'vitest'

import {
  buildPurlCorpus,
  formatBenchResult,
} from '../scripts/repo/bench-from-string.mts'

describe('from-string benchmark helpers', () => {
  it('builds a deterministic mixed package URL corpus', () => {
    const corpus = buildPurlCorpus(24)

    expect(corpus).toHaveLength(24)
    expect(new Set(corpus)).toHaveLength(24)
    expect(corpus).toContain('pkg:npm/%40scope0/core-0@1.0.0')
    expect(corpus.some(purl => purl.startsWith('pkg:maven/'))).toBe(true)
    expect(corpus.some(purl => purl.includes('?extension=tgz'))).toBe(true)
  })

  it('formats every measured field in one result row', () => {
    const formatted = formatBenchResult({
      cpuMs: 12.34,
      gcCount: 2,
      gcPauseMs: 0.75,
      label: 'distinct',
      opsPerSec: 12_345,
      parsed: 500,
      wallMs: 13.5,
    })

    expect(formatted).toContain('distinct')
    expect(formatted).toContain('12.3 ms cpu')
    expect(formatted).toContain('13.5 ms wall')
    expect(formatted).toContain('12,345 ops/s')
    expect(formatted).toContain('500 parsed')
    expect(formatted).toContain('2 gc')
  })
})
