/**
 * @file Tests for scripts/repo/check/purlerror-messages-are-lowercase.mts
 *   Covers both arms (compliant passes, violation detected) for every exported
 *   function, ensuring the check is self-consistent.
 */
import { unlinkSync, writeFileSync } from 'node:fs'
import process from 'node:process'

import { describe, expect, it } from 'vitest'

import { REPO_ROOT } from '../scripts/fleet/paths.mts'
import {
  checkMessageShape,
  collectSourceFiles,
  extractFirstStringArg,
  scanFile,
  scanSrc,
} from '../scripts/repo/check/purlerror-messages-are-lowercase.mts'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

const logger = getDefaultLogger()

// ---------------------------------------------------------------------------
// checkMessageShape
// ---------------------------------------------------------------------------
describe('checkMessageShape', () => {
  it('returns undefined for a compliant lowercase message', () => {
    expect(checkMessageShape('missing required component')).toBeUndefined()
  })

  it('returns undefined for an empty string', () => {
    expect(checkMessageShape('')).toBeUndefined()
  })

  it('returns a reason when first character is uppercase', () => {
    const reason = checkMessageShape('Missing required component')
    expect(reason).toMatch(/uppercase/)
    expect(reason).toMatch(/'M'/)
  })

  it('returns a reason when message ends with a period', () => {
    const reason = checkMessageShape('missing required component.')
    expect(reason).toMatch(/trailing period/)
  })

  it('returns undefined for a message starting with a digit', () => {
    expect(checkMessageShape('1 component is required')).toBeUndefined()
  })

  it('returns undefined for a message starting with a quote character', () => {
    expect(checkMessageShape('"name" must be a string')).toBeUndefined()
  })

  it('returns undefined for a message starting with a non-alpha character', () => {
    expect(checkMessageShape('"type" is required')).toBeUndefined()
  })

  it('detects uppercase start regardless of message content', () => {
    const reason = checkMessageShape('VERS string is required')
    expect(reason).toMatch(/uppercase/)
    expect(reason).toMatch(/'V'/)
  })
})

// ---------------------------------------------------------------------------
// extractFirstStringArg
// ---------------------------------------------------------------------------
describe('extractFirstStringArg', () => {
  it('extracts a single-quoted string argument', () => {
    const line = `      throw new PurlError('missing required component')`
    const idx = line.indexOf('new PurlError(')
    expect(extractFirstStringArg(line, idx)).toBe('missing required component')
  })

  it('extracts a double-quoted string argument', () => {
    const line = `      throw new PurlError("missing required component")`
    const idx = line.indexOf('new PurlError(')
    expect(extractFirstStringArg(line, idx)).toBe('missing required component')
  })

  it('extracts a backtick template without interpolation', () => {
    const line = 'throw new PurlError(`qualifier key must not be empty`)'
    const idx = line.indexOf('new PurlError(')
    expect(extractFirstStringArg(line, idx)).toBe(
      'qualifier key must not be empty',
    )
  })

  it('returns undefined for a template literal starting with interpolation', () => {
    const line = 'throw new PurlError(`${type} component is invalid`)'
    const idx = line.indexOf('new PurlError(')
    expect(extractFirstStringArg(line, idx)).toBeUndefined()
  })

  it('returns undefined when there is no opening paren', () => {
    const line = 'throw new PurlError'
    const idx = line.indexOf('new PurlError')
    expect(extractFirstStringArg(line, idx)).toBeUndefined()
  })

  it('returns undefined when the argument is an identifier (no quotes)', () => {
    const line = 'throw new PurlError(msg)'
    const idx = line.indexOf('new PurlError(')
    expect(extractFirstStringArg(line, idx)).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// scanFile (inline fixture via temp files)
// ---------------------------------------------------------------------------
describe('scanFile with a temp fixture', () => {
  it('reports violations in a file containing uppercase literals', () => {
    const tmpFile = `/tmp/purlerror-check-test-${process.pid}.mts`
    writeFileSync(
      tmpFile,
      [
        "throw new PurlError('VERS string is required')",
        "throw new PurlError('Missing required component')",
        "throw new PurlError('compliant message')",
        "throw new PurlError('trailing period.')",
      ].join('\n'),
    )
    try {
      const violations = scanFile(tmpFile, '/tmp')
      expect(violations.length).toBe(3)
      const messages = violations.map(v => v.message)
      expect(messages).toContain('VERS string is required')
      expect(messages).toContain('Missing required component')
      expect(messages).toContain('trailing period.')
      expect(messages).not.toContain('compliant message')
    } finally {
      unlinkSync(tmpFile)
    }
  })

  it('detects violations in a two-line call (arg on next line)', () => {
    const tmpFile = `/tmp/purlerror-check-test-multiline-${process.pid}.mts`
    writeFileSync(
      tmpFile,
      [
        'throw new PurlError(',
        "  'VERS constraint must not be empty',",
        ')',
        'throw new PurlError(',
        "  'compliant message',",
        ')',
      ].join('\n'),
    )
    try {
      const violations = scanFile(tmpFile, '/tmp')
      expect(violations.length).toBe(1)
      expect(violations[0]?.message).toBe('VERS constraint must not be empty')
    } finally {
      unlinkSync(tmpFile)
    }
  })

  it('returns empty array for a file with only compliant messages', () => {
    const tmpFile = `/tmp/purlerror-check-test-clean-${process.pid}.mts`
    writeFileSync(
      tmpFile,
      [
        "throw new PurlError('missing required component')",
        "throw new PurlError('qualifier key must not be empty')",
      ].join('\n'),
    )
    try {
      const violations = scanFile(tmpFile, '/tmp')
      expect(violations.length).toBe(0)
    } finally {
      unlinkSync(tmpFile)
    }
  })

  it('returns empty array for a nonexistent file', () => {
    expect(scanFile('/tmp/does-not-exist-999.mts', '/tmp')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// collectSourceFiles
// ---------------------------------------------------------------------------
describe('collectSourceFiles', () => {
  it('returns empty array for a nonexistent directory', () => {
    expect(collectSourceFiles('/tmp/nonexistent-dir-for-test-999')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// scanSrc integration — the actual repo must pass cleanly
// ---------------------------------------------------------------------------
describe('scanSrc integration', () => {
  it('finds no violations in the live src/ tree', () => {
    const violations = scanSrc(REPO_ROOT)
    if (violations.length) {
      for (const v of violations) {
        logger.fail(`  ✗ ${v.file}:${v.line} "${v.message}" — ${v.reason}`)
      }
    }
    expect(violations).toHaveLength(0)
  })
})
