/**
 * @file Repo-owned check: PurlError first-arg literals must be lowercase (no
 *   leading capital) and must not end with a period. The convention is enforced
 *   at runtime by `formatPurlErrorMessage` in src/error.mts — which lowercase
 *   the first character and strips a trailing period — but call-site literals
 *   should already conform so the formatter is an idempotent passthrough, not a
 *   corrector. Drift at the call-site is a silent bug: a maintainer reading
 *   `new PurlError('Something.')` sees the wrong convention without realizing
 *   the formatter silently patches it. Scans: `src/**\/*.mts` and
 *   `src/**\/*.ts` for `new PurlError(` followed by a string literal
 *   (single-quote, double-quote, or backtick without interpolation). Template
 *   literals that open with `${` are skipped because their first character is
 *   dynamic. Usage: node
 *   scripts/repo/check/purlerror-messages-are-lowercase.mts [--quiet]
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import type { Dirent } from 'node:fs'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../../fleet/paths.mts'

const logger = getDefaultLogger()

export interface MessageViolation {
  readonly file: string
  readonly line: number
  readonly message: string
  readonly reason: string
}

// Collect all .mts / .ts source files under a directory, recursively.
export function collectSourceFiles(dir: string): string[] {
  const results: string[] = []
  // Explicit Dirent[] — the bare `ReturnType<typeof readdirSync>` resolves
  // to the buffer overload under @types/node 26.
  let entries: Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return results
  }
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const entry = entries[i]!
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const nested = collectSourceFiles(full)
      for (let j = 0, { length: jlen } = nested; j < jlen; j += 1) {
        results.push(nested[j]!)
      }
    } else if (
      entry.isFile() &&
      (entry.name.endsWith('.mts') || entry.name.endsWith('.ts')) &&
      !entry.name.endsWith('.d.ts')
    ) {
      results.push(full)
    }
  }
  return results
}

// Extract the first string literal argument from a `new PurlError(` call on a
// given line. Returns undefined when the argument is dynamic (template with
// interpolation, bare identifier, etc.) or absent. Works on single-line
// literals only — multi-line template literals that continue past the current
// line are excluded via the interpolation check.
export function extractFirstStringArg(
  line: string,
  callStart: number,
): string | undefined {
  const parenIdx = line.indexOf('(', callStart)
  if (parenIdx === -1) {
    return undefined
  }
  const after = line.slice(parenIdx + 1).trimStart()
  if (after.length === 0) {
    return undefined
  }
  const q = after[0]
  if (q === "'" || q === '"') {
    // Single or double quoted literal — grab content up to matching close.
    const rest = after.slice(1)
    const close = rest.indexOf(q)
    if (close === -1) {
      return undefined
    }
    return rest.slice(0, close)
  }
  if (q === '`') {
    // Template literal — only handle when there is NO interpolation so the
    // first character is truly static.
    const rest = after.slice(1)
    if (rest.startsWith('${')) {
      return undefined
    }
    const close = rest.indexOf('`')
    const interp = rest.indexOf('${')
    if (close === -1) {
      return undefined
    }
    const content =
      interp !== -1 && interp < close ? undefined : rest.slice(0, close)
    return content
  }
  return undefined
}

// Check whether a literal message violates the PurlError shape rule.
// Returns the reason string on violation, or undefined when compliant.
export function checkMessageShape(msg: string): string | undefined {
  if (msg.length === 0) {
    return undefined
  }
  const first = msg[0]!
  if (first >= 'A' && first <= 'Z') {
    return `starts with uppercase '${first}' — PurlError literals must begin with a lowercase character`
  }
  if (msg[msg.length - 1] === '.') {
    return `ends with '.' — PurlError literals must not have a trailing period`
  }
  return undefined
}

// Scan a single file for PurlError message shape violations.
// Handles both same-line literals and the common two-line pattern where
// the opening call is `new PurlError(\n  '<literal>',\n)`.
export function scanFile(
  filePath: string,
  repoRoot: string,
): MessageViolation[] {
  let source: string
  try {
    source = readFileSync(filePath, 'utf8')
  } catch {
    return []
  }
  const lines = source.split('\n')
  const violations: MessageViolation[] = []
  const rel = path.relative(repoRoot, filePath)
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    let searchStart = 0
    while (true) {
      const callIdx = line.indexOf('new PurlError(', searchStart)
      if (callIdx === -1) {
        break
      }
      // First try to extract the arg from the same line.
      let msg = extractFirstStringArg(line, callIdx)
      let reportLine = i + 1
      if (msg === undefined && i + 1 < length) {
        // When the line ends with `new PurlError(` and nothing follows, look
        // at the next non-empty continuation line for the first arg. This
        // covers the common formatter-split two-line shape:
        //   throw new PurlError(
        //     'literal here',
        //   )
        const afterParen = line.slice(callIdx + 'new PurlError('.length).trim()
        if (afterParen.length === 0) {
          const nextLine = lines[i + 1]!.trim()
          msg = extractFirstStringArg(`f(${nextLine}`, 1)
          reportLine = i + 2
        }
      }
      if (msg !== undefined) {
        const reason = checkMessageShape(msg)
        if (reason) {
          violations.push({
            file: rel,
            line: reportLine,
            message: msg,
            reason,
          })
        }
      }
      searchStart = callIdx + 'new PurlError('.length
    }
  }
  return violations
}

// Scan all src/ source files and return violations.
export function scanSrc(repoRoot: string): MessageViolation[] {
  const srcDir = path.join(repoRoot, 'src')
  let stat: ReturnType<typeof statSync> | undefined
  try {
    stat = statSync(srcDir)
  } catch {
    return []
  }
  if (!stat.isDirectory()) {
    return []
  }
  const files = collectSourceFiles(srcDir)
  const violations: MessageViolation[] = []
  for (let i = 0, { length } = files; i < length; i += 1) {
    const fileViolations = scanFile(files[i]!, repoRoot)
    for (let j = 0, { length: jlen } = fileViolations; j < jlen; j += 1) {
      violations.push(fileViolations[j]!)
    }
  }
  return violations
}

function main(): void {
  const quiet = process.argv.includes('--quiet')
  const violations = scanSrc(REPO_ROOT)
  if (violations.length) {
    logger.fail(
      '[purlerror-messages-are-lowercase] PurlError literal message shape violations:',
    )
    for (let i = 0, { length } = violations; i < length; i += 1) {
      const v = violations[i]!
      logger.error(`  ✗ ${v.file}:${v.line} "${v.message}" — ${v.reason}`)
    }
    logger.error(
      '  PurlError first-arg literals must start with a lowercase character and must not end with a period.',
    )
    process.exitCode = 1
    return
  }
  if (!quiet) {
    logger.success(
      '[purlerror-messages-are-lowercase] all PurlError literals are lowercase with no trailing period.',
    )
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
