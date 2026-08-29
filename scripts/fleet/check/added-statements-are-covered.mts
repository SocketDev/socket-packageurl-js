#!/usr/bin/env node
/*
 * @file Assert every statement a commit ADDS is covered — the diff is the gate,
 *   so the coverage backlog stops growing.
 *
 *   The Cover thresholds guard the AGGREGATE, which a small uncovered addition
 *   slips under: 40 new uncovered lines in a large tree move the percentage by
 *   less than the ratchet band, so the gate stays green while the backlog
 *   grows. This check reads the DIFF instead. Every line a range adds is
 *   intersected with the merged istanbul report's `statementMap`, and an added
 *   statement whose hit count is 0 is a finding named `file:line`.
 *
 *   Only instrumented files count: the include/exclude globs come from
 *   `.config/repo/socket-wheelhouse.json` (`coverage.include`,
 *   `coverage.exclude.add`), never from a copy in this file.
 *
 *   The entrypoint tail is exempt. Statements inside
 *   `if (isMainModule(import.meta.url)) { runMain(...) }` run only when node
 *   executes the file as the process entry, so an in-process suite can never
 *   cover them. The block is found structurally (guard, then brace match),
 *   never by counting lines from the end of the file.
 *
 *   Fail-open skips, each printed explicitly so a skip never reads as a pass:
 *   an unresolvable diff range (no origin remote, shallow clone), or a missing
 *   coverage report (`pnpm run cover` has not run on this tree).
 *
 *   Exit: 0 covered or not checkable; 1 at least one uncovered added statement.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'
import {
  COVERAGE_FINAL_PATH,
  findSocketWheelhouseConfig,
  REPO_ROOT,
} from '../paths.mts'

const logger = getDefaultLogger()

const CHECK_ID = 'added-statements-are-covered'

// Fallback default-branch names, in resolution order, when the remote's HEAD
// symbolic ref is absent (a clone that never fetched origin/HEAD).
export const DEFAULT_BRANCH_FALLBACKS = ['main', 'master'] as const

/**
 * An inclusive 1-based line span a diff hunk added to one file.
 */
export type AddedRange = {
  start: number
  end: number
}

/**
 * One statement a range added that the coverage report shows unhit.
 */
export type UncoveredStatement = {
  file: string
  line: number
  column: number
}

export type StatementLocation = {
  start: { column?: number | undefined; line: number }
  end?: { column?: number | undefined; line: number } | undefined
}

export type CoverageFileEntry = {
  path?: string | undefined
  // A v8 coverage JSON shape: statement ids keyed by string.
  // oxlint-disable-next-line socket/prefer-refined-record -- coverage JSON
  statementMap?: Record<string, StatementLocation> | undefined
  s?: Record<string, number> | undefined
}

// A v8 coverage report is a JSON document keyed by file path.
// oxlint-disable-next-line socket/prefer-refined-record -- coverage JSON
export type CoverageReport = Record<string, CoverageFileEntry>

export type InstrumentedGlobs = {
  include: string[]
  exclude: string[]
}

/**
 * Split text on newlines with CRLF normalized away first.
 */
export function splitDiffLines(text: string): string[] {
  return text.replace(/\r\n/g, '\n').split(/\r?\n/)
}

/**
 * A regexp equivalent of one path glob: `**` followed by a slash spans
 * directory segments, `*` and `?` stay inside a single segment, and a `[...]`
 * class passes through. Written here rather than pulled from a matcher library
 * so the intersection stays pure and a unit test needs no filesystem.
 */
export function globToRegExp(glob: string): RegExp {
  let out = '^'
  for (let i = 0, { length } = glob; i < length; i += 1) {
    const ch = glob[i]!
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        i += 1
        if (glob[i + 1] === '/') {
          i += 1
          out += '(?:[^/]+/)*'
        } else {
          out += '.*'
        }
      } else {
        out += '[^/]*'
      }
      continue
    }
    if (ch === '?') {
      out += '[^/]'
      continue
    }
    if (ch === '[') {
      const close = glob.indexOf(']', i + 1)
      if (close !== -1) {
        out += `[${glob.slice(i + 1, close)}]`
        i = close
        continue
      }
    }
    out += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`${out}$`)
}

/**
 * Whether a repo-relative path matches at least one of the globs.
 */
export function matchesAnyGlob(
  filePath: string,
  globs: readonly string[],
): boolean {
  const unixPath = normalizePath(filePath)
  for (let i = 0, { length } = globs; i < length; i += 1) {
    if (globToRegExp(globs[i]!).test(unixPath)) {
      return true
    }
  }
  return false
}

/**
 * Whether the coverage config instruments this path: matched by an include
 * glob and by no added exclude glob.
 */
export function isInstrumentedPath(
  filePath: string,
  globs: InstrumentedGlobs,
): boolean {
  return (
    matchesAnyGlob(filePath, globs.include) &&
    !matchesAnyGlob(filePath, globs.exclude)
  )
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  const out: string[] = []
  for (let i = 0, { length } = value; i < length; i += 1) {
    const entry = value[i]
    if (typeof entry === 'string' && entry) {
      out.push(entry)
    }
  }
  return out
}

/**
 * The `coverage.include` list and the `coverage.exclude.add` list from a
 * socket-wheelhouse.json payload. An unreadable or absent block yields empty
 * lists, which the caller reads as "nothing is instrumented here".
 */
export function readInstrumentedGlobs(configText: string): InstrumentedGlobs {
  const empty: InstrumentedGlobs = { exclude: [], include: [] }
  let parsed: unknown
  try {
    parsed = JSON.parse(configText)
  } catch {
    return empty
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return empty
  }
  const coverage = (parsed as Record<string, unknown>)['coverage']
  if (typeof coverage !== 'object' || coverage === null) {
    return empty
  }
  const block = coverage as Record<string, unknown>
  const exclude = block['exclude']
  const added =
    typeof exclude === 'object' && exclude !== null
      ? readStringArray((exclude as Record<string, unknown>)['add'])
      : []
  return { exclude: added, include: readStringArray(block['include']) }
}

/**
 * Per-file ADDED line ranges from a `git diff --unified=0` payload. A hunk's
 * `+c,d` side names the added span; a `d` of 0 is a pure deletion and
 * contributes nothing. Keys are the diff's post-image paths, repo-relative.
 */
export function parseAddedRanges(diffText: string): Map<string, AddedRange[]> {
  const out = new Map<string, AddedRange[]>()
  const lines = splitDiffLines(diffText)
  let current: string | undefined
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (line.startsWith('+++ ')) {
      const target = line.slice(4).trim()
      current =
        target === '/dev/null'
          ? undefined
          : normalizePath(target.startsWith('b/') ? target.slice(2) : target)
      continue
    }
    if (!line.startsWith('@@') || current === undefined) {
      continue
    }
    // A unified hunk header: `-<oldStart>[,<oldCount>]` is skipped, then group
    // 1 captures the post-image start line and optional group 2 its line count
    // (git omits `,<count>` when the span is exactly one line).
    const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line)
    if (!match) {
      continue
    }
    const start = Number(match[1])
    const count = match[2] === undefined ? 1 : Number(match[2])
    if (!Number.isFinite(start) || count <= 0) {
      continue
    }
    const range: AddedRange = { end: start + count - 1, start }
    const ranges = out.get(current)
    if (ranges) {
      ranges.push(range)
    } else {
      out.set(current, [range])
    }
  }
  return out
}

function lineIsInAnyRange(
  line: number,
  ranges: readonly AddedRange[],
): boolean {
  for (let i = 0, { length } = ranges; i < length; i += 1) {
    const range = ranges[i]!
    if (line >= range.start && line <= range.end) {
      return true
    }
  }
  return false
}

function lineAtIndex(text: string, index: number): number {
  let line = 1
  for (let i = 0; i < index; i += 1) {
    if (text[i] === '\n') {
      line += 1
    }
  }
  return line
}

/**
 * The line span of the `if (isMainModule(import.meta.url)) { … }` entrypoint
 * guard, found structurally: locate the guard, then brace-match its body. The
 * span covers the guard line through the closing brace, so every statement the
 * block holds is exempt. `undefined` when the file has no guard.
 */
export function entrypointGuardRange(
  sourceText: string,
): AddedRange | undefined {
  const guardIndex = sourceText.indexOf('isMainModule(import.meta.url)')
  if (guardIndex === -1) {
    return undefined
  }
  const openIndex = sourceText.indexOf('{', guardIndex)
  if (openIndex === -1) {
    return undefined
  }
  let depth = 0
  let closeIndex = -1
  for (let i = openIndex, { length } = sourceText; i < length; i += 1) {
    const ch = sourceText[i]
    if (ch === '{') {
      depth += 1
    } else if (ch === '}') {
      depth -= 1
      if (depth === 0) {
        closeIndex = i
        break
      }
    }
  }
  if (closeIndex === -1) {
    return undefined
  }
  return {
    end: lineAtIndex(sourceText, closeIndex),
    start: lineAtIndex(sourceText, guardIndex),
  }
}

/**
 * Every statement whose start line sits in an added range and whose hit count
 * is 0, skipping any statement inside that file's exempt ranges. Pure: the
 * caller supplies the diff ranges, the report, and the exemptions, so a test
 * needs neither git nor a real coverage run.
 */
export function findUncoveredAddedStatements(
  addedByFile: ReadonlyMap<string, readonly AddedRange[]>,
  reportByFile: ReadonlyMap<string, CoverageFileEntry>,
  exemptByFile?: ReadonlyMap<string, readonly AddedRange[]> | undefined,
): UncoveredStatement[] {
  const out: UncoveredStatement[] = []
  for (const { 0: file, 1: ranges } of addedByFile) {
    const entry = reportByFile.get(file)
    if (!entry) {
      continue
    }
    const { s: hits, statementMap } = entry
    if (!statementMap || !hits) {
      continue
    }
    const exempt = exemptByFile?.get(file) ?? []
    const ids = Object.keys(statementMap)
    for (let i = 0, { length } = ids; i < length; i += 1) {
      const id = ids[i]!
      const location = statementMap[id]
      if (!location) {
        continue
      }
      const { line } = location.start
      if (!lineIsInAnyRange(line, ranges) || lineIsInAnyRange(line, exempt)) {
        continue
      }
      if (hits[id] === 0) {
        out.push({ column: location.start.column ?? 0, file, line })
      }
    }
  }
  out.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
  return out
}

async function runGit(args: readonly string[]): Promise<string | undefined> {
  try {
    const result = await spawn('git', [...args], {
      cwd: REPO_ROOT,
      stdioString: true,
    })
    if (result.code !== 0) {
      return undefined
    }
    return String(result.stdout ?? '')
  } catch {
    return undefined
  }
}

async function revisionExists(revision: string): Promise<boolean> {
  return (
    (await runGit(['rev-parse', '--verify', '--quiet', revision])) !== undefined
  )
}

/**
 * The default branch's remote-tracking ref, resolved from `origin/HEAD` and
 * falling back through the conventional names. `undefined` when no remote
 * default branch is reachable (no origin, or a shallow single-branch clone).
 */
export async function resolveDefaultRemoteRef(): Promise<string | undefined> {
  const symbolic = await runGit([
    'symbolic-ref',
    '--quiet',
    'refs/remotes/origin/HEAD',
  ])
  if (symbolic) {
    const name = symbolic.trim().replace(/^refs\/remotes\//, '')
    if (name && (await revisionExists(name))) {
      return name
    }
  }
  for (let i = 0, { length } = DEFAULT_BRANCH_FALLBACKS; i < length; i += 1) {
    const candidate = `origin/${DEFAULT_BRANCH_FALLBACKS[i]!}`
    if (await revisionExists(candidate)) {
      return candidate
    }
  }
  return undefined
}

/**
 * The `--range <a>..<b>` value from an argv list, when present.
 */
export function readRangeFlag(argv: readonly string[]): string | undefined {
  const index = argv.indexOf('--range')
  if (index === -1) {
    return undefined
  }
  const value = argv[index + 1]
  return value && !value.startsWith('--') ? value : undefined
}

/**
 * The report keyed by repo-relative path, keeping only instrumented files. The
 * merged istanbul report keys are absolute, so the relativization happens here
 * and the pure intersection above sees one path shape.
 */
export function relativizeReport(
  report: CoverageReport,
  globs: InstrumentedGlobs,
  repoRoot: string,
): Map<string, CoverageFileEntry> {
  const out = new Map<string, CoverageFileEntry>()
  const keys = Object.keys(report)
  for (let i = 0, { length } = keys; i < length; i += 1) {
    const key = keys[i]!
    const entry = report[key]
    if (!entry) {
      continue
    }
    const absolute = entry.path ?? key
    const relative = normalizePath(
      path.isAbsolute(absolute) ? path.relative(repoRoot, absolute) : absolute,
    )
    if (!relative || relative.startsWith('..')) {
      continue
    }
    if (isInstrumentedPath(relative, globs)) {
      out.set(relative, entry)
    }
  }
  return out
}

/**
 * The exempt entrypoint span for each file the diff touched, read from the
 * live source on disk. A file with no guard contributes no entry.
 */
export function collectEntrypointExemptions(
  files: Iterable<string>,
  repoRoot: string,
): Map<string, AddedRange[]> {
  const out = new Map<string, AddedRange[]>()
  for (const file of files) {
    const absolute = path.join(repoRoot, file)
    if (!existsSync(absolute)) {
      continue
    }
    const guard = entrypointGuardRange(readFileSync(absolute, 'utf8'))
    if (guard) {
      out.set(file, [guard])
    }
  }
  return out
}

/**
 * Injectable paths, so the skip arms are testable. `COVERAGE_FINAL_PATH` is
 * module-scope in `paths.mts`, and a spec cannot make it absent without either
 * an injected path here or a module mock. Injection is the smaller of the two:
 * it keeps the spec free of vitest module machinery, and the skip arms are the
 * ones worth pinning because each must read as SKIPPED rather than as a pass.
 */
export interface MainOptions {
  readonly coverageFinalPath?: string | undefined
}

export async function main(options?: MainOptions | undefined): Promise<void> {
  const { coverageFinalPath = COVERAGE_FINAL_PATH } = {
    __proto__: null,
    ...options,
  } as MainOptions
  const { argv } = process
  const staged = argv.includes('--staged')
  const explicitRange = readRangeFlag(argv)
  let diffArgs: string[]
  let rangeLabel: string
  if (staged) {
    diffArgs = ['diff', '--unified=0', '--cached']
    rangeLabel = 'the staged index'
  } else if (explicitRange) {
    diffArgs = ['diff', '--unified=0', explicitRange]
    rangeLabel = explicitRange
  } else {
    const baseRef = await resolveDefaultRemoteRef()
    if (!baseRef) {
      logger.info(
        `[${CHECK_ID}] SKIPPED: no default-branch remote ref to diff against (no origin, or a shallow clone). Pass --range <a>..<b> or --staged.`,
      )
      return
    }
    rangeLabel = `${baseRef}..HEAD`
    diffArgs = ['diff', '--unified=0', rangeLabel]
  }
  const diffText = await runGit(diffArgs)
  if (diffText === undefined) {
    logger.info(
      `[${CHECK_ID}] SKIPPED: git could not resolve the diff range ${rangeLabel}.`,
    )
    return
  }
  const addedByFile = parseAddedRanges(diffText)
  if (!addedByFile.size) {
    logger.success(`[${CHECK_ID}] ${rangeLabel} adds no lines.`)
    return
  }
  if (!existsSync(coverageFinalPath)) {
    logger.info(
      `[${CHECK_ID}] SKIPPED: no coverage report at ${path.relative(REPO_ROOT, coverageFinalPath)}. \`pnpm run cover\` has not run on this tree, so the added statements were NOT verified.`,
    )
    return
  }
  const location = findSocketWheelhouseConfig()
  if (!location) {
    logger.info(
      `[${CHECK_ID}] SKIPPED: no socket-wheelhouse.json to read coverage.include from.`,
    )
    return
  }
  const globs = readInstrumentedGlobs(readFileSync(location.path, 'utf8'))
  if (!globs.include.length) {
    logger.info(
      `[${CHECK_ID}] SKIPPED: coverage.include is empty, so no file on this tree is instrumented.`,
    )
    return
  }
  let report: CoverageReport
  try {
    report = JSON.parse(
      readFileSync(coverageFinalPath, 'utf8'),
    ) as CoverageReport
  } catch {
    logger.info(
      `[${CHECK_ID}] SKIPPED: the coverage report is not readable JSON. Re-run \`pnpm run cover\`.`,
    )
    return
  }
  const reportByFile = relativizeReport(report, globs, REPO_ROOT)
  const findings = findUncoveredAddedStatements(
    addedByFile,
    reportByFile,
    collectEntrypointExemptions(reportByFile.keys(), REPO_ROOT),
  )
  if (!findings.length) {
    logger.success(
      `[${CHECK_ID}] every instrumented statement ${rangeLabel} adds is covered.`,
    )
    return
  }
  const plural = findings.length === 1 ? '' : 's'
  logger.fail(
    `[${CHECK_ID}] ${findings.length} added statement${plural} ${findings.length === 1 ? 'is' : 'are'} uncovered.`,
  )
  logger.error(`  Where: ${rangeLabel}`)
  for (let i = 0, { length } = findings; i < length; i += 1) {
    const finding = findings[i]!
    logger.error(`         ${finding.file}:${finding.line}`)
  }
  logger.error(
    '  Saw:    a statement this range ADDED with 0 hits in the last cover run.\n' +
      '  Wanted: every added statement exercised by a test.\n' +
      '  Fix:    add a test that reaches each line above, then re-run\n' +
      '          `pnpm run cover` and this check. A line reachable only as a\n' +
      '          real process entry belongs inside the\n' +
      '          `if (isMainModule(import.meta.url))` guard, which is exempt.',
  )
  process.exitCode = 1
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'checks every statement a diff range adds is covered, so the coverage backlog stops growing',
  help: `Usage: node scripts/fleet/check/added-statements-are-covered.mts [--staged] [--range <a>..<b>]

  Default range: <default-branch remote ref>..HEAD.
  --staged            gate the staged index instead of a commit range.
  --range <a>..<b>    gate an explicit range.`,
}

/* c8 ignore start - entrypoint guard; only runs when node executes this file as the process entry, never under the in-process test runner */
if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
/* c8 ignore stop */
