#!/usr/bin/env node
/*
 * @file Gate: every glob list in a fleet config is byte-sorted.
 *
 *   An `ignores` / `exclude` / `globs` array grows by append, so an unsorted
 *   list is the default outcome rather than a mistake someone made. The cost
 *   shows up twice: a reader cannot tell whether a path is already covered
 *   without reading every entry, and two sessions appending in different spots
 *   produce a conflict in a file that has no semantic ordering at all.
 *
 *   Byte order, not locale order, and the leading `**` is part of the string: a
 *   `.`-leading segment sorts before a letter, so a `.cache` glob leads the
 *   list. Two globs sharing a prefix order by the next byte, which is why a
 *   `scripts/**` form precedes the `scripts/templates` one.
 *
 *   Order matters in one shape this check must not break: an
 *   ignore-then-re-include sequence, where a later pattern overrides an
 *   earlier one. A list carrying an `order-matters` marker comment is skipped.
 *
 *   An entry may share its line with a trailing comment (`"zzz/**", // why`).
 *   The comment travels with its entry through a sort, since it explains that
 *   glob and would otherwise end up describing a different one. The comma stays
 *   with the line: only the last line of a list omits it, and that position
 *   does not move.
 *
 *   Usage: node scripts/fleet/check/glob-lists-are-sorted.mts [--json] [--fix]
 */

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import type { ScriptMeta } from '../_shared/run-main.mts'
import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

/**
 * The array keys whose values are glob lists.
 */
export const GLOB_LIST_KEYS: readonly string[] = [
  'exclude',
  'excludes',
  'globs',
  'ignore',
  'ignores',
]

/**
 * A list carrying this marker anywhere inside it keeps its hand-written order.
 */
export const ORDER_MARKER = 'order-matters'

/**
 * One entry line, captured as (indent)(quote)(value)(comma)(trailing comment).
 * A quoted string alone on the line, optionally followed by a comma and a
 * `//`/`#` comment. A standalone comment line or a nested structure does not
 * match and is left in place.
 *
 * Both the read and the rewrite use THIS regex. Two predicates that differ by
 * a character disagree about what an entry is, and the read then judges a
 * subset of what the rewrite moves.
 */
const ENTRY_LINE_RE = /^(\s*)(["'])([^"']+)\2(,?)(\s*(?:#|\/\/).*)?$/

export interface GlobList {
  readonly end: number
  readonly entries: readonly string[]
  readonly hasOrderMarker: boolean
  readonly key: string
  readonly start: number
}

export interface GlobListFinding {
  readonly file: string
  readonly key: string
  readonly line: number
  readonly saw: readonly string[]
  readonly sorted: readonly string[]
}

/**
 * Byte-order comparison, the fleet's sort for every non-prose list. `<` on a
 * JS string compares UTF-16 code units, which matches byte order for the ASCII
 * a glob is written in.
 */
export function compareGlobs(a: string, b: string): number {
  if (a < b) {
    return -1
  }
  return a > b ? 1 : 0
}

/**
 * Every glob list in `text`, with the lines it spans. Reads line-by-line
 * rather than parsing: the fleet's configs are JSONC and YAML with comments,
 * and a parse would drop the comments a rewrite has to preserve.
 */
export function findGlobLists(text: string): GlobList[] {
  const lines = text.split(/\r?\n/)
  const out: GlobList[] = []
  for (let i = 0, { length } = lines; i < length; i += 1) {
    // An array-opening line: optional indent, the key with or without quotes
    // (JSON vs. a .mts literal), the colon, the `[`, then nothing but optional
    // trailing whitespace or a `//` comment. A line carrying entries after the
    // bracket is not an opener, so a single-line array is left alone.
    const opener = /^\s*"?([A-Za-z]+)"?\s*:\s*\[\s*(?:\/\/.*)?$/.exec(lines[i]!)
    if (!opener || !GLOB_LIST_KEYS.includes(opener[1]!)) {
      continue
    }
    const entries: string[] = []
    let hasOrderMarker = false
    let end = -1
    for (let j = i + 1; j < length; j += 1) {
      const trimmed = lines[j]!.trim()
      if (trimmed.startsWith(']')) {
        end = j
        break
      }
      if (trimmed.startsWith('//') || trimmed.startsWith('#')) {
        if (trimmed.includes(ORDER_MARKER)) {
          hasOrderMarker = true
        }
        continue
      }
      const value = ENTRY_LINE_RE.exec(trimmed)
      if (value) {
        entries.push(value[3]!)
      }
    }
    if (end !== -1 && entries.length > 1) {
      out.push({ end, entries, hasOrderMarker, key: opener[1]!, start: i })
      i = end
    }
  }
  return out
}

/**
 * Every unsorted glob list in one file.
 */
export function scanGlobLists(text: string, file: string): GlobListFinding[] {
  const findings: GlobListFinding[] = []
  const lists = findGlobLists(text)
  for (let i = 0, { length } = lists; i < length; i += 1) {
    const list = lists[i]!
    if (list.hasOrderMarker) {
      continue
    }
    const sorted = list.entries.toSorted(compareGlobs)
    if (sorted.join(' ') !== list.entries.join(' ')) {
      findings.push({
        file,
        key: list.key,
        line: list.start + 1,
        saw: list.entries,
        sorted,
      })
    }
  }
  return findings
}

/**
 * Reorder the quoted entries of every sortable list, leaving each comment line
 * where it sits so an explanation stays with the position it was written for.
 */
export function sortGlobListsInText(text: string): string {
  const lines = text.split(/\r?\n/)
  const lists = findGlobLists(text).filter(list => !list.hasOrderMarker)
  for (let i = 0, { length } = lists; i < length; i += 1) {
    const list = lists[i]!
    // Collect (value, comment) pairs first. A trailing comment explains the
    // entry it sits on, so it MOVES with that entry — leaving it at its old
    // line position would attach the explanation to a different glob.
    const pairs: Array<{ comment: string; value: string }> = []
    for (let j = list.start + 1; j < list.end; j += 1) {
      const match = ENTRY_LINE_RE.exec(lines[j]!)
      if (match) {
        pairs.push({ comment: match[5] ?? '', value: match[3]! })
      }
    }
    const sorted = pairs.toSorted((a, b) => compareGlobs(a.value, b.value))
    // The comma stays with the LINE, not the entry: only the final line of a
    // list omits it, and that position does not move.
    let next = 0
    for (let j = list.start + 1; j < list.end; j += 1) {
      const match = ENTRY_LINE_RE.exec(lines[j]!)
      if (!match) {
        continue
      }
      const pair = sorted[next]!
      lines[j] =
        `${match[1]!}${match[2]!}${pair.value}${match[2]!}${match[4]!}${pair.comment}`
      next += 1
    }
  }
  return lines.join('\n')
}

/**
 * The configs this gate reads. The set is explicit so the walk never wanders
 * into a member's own tooling.
 */
export const SCANNED_CONFIGS: readonly string[] = [
  path.join('.config', 'fleet', '.markdownlint-cli2.jsonc'),
  path.join('.config', 'fleet', 'oxlintrc.json'),
  path.join('.config', 'repo', 'oxlintrc.json'),
  'tsconfig.json',
]

export function scanRepo(
  options?: { root?: string | undefined } | undefined,
): GlobListFinding[] {
  const { root = REPO_ROOT } = { __proto__: null, ...options } as NonNullable<
    typeof options
  >
  const findings: GlobListFinding[] = []
  for (let i = 0, { length } = SCANNED_CONFIGS; i < length; i += 1) {
    const rel = SCANNED_CONFIGS[i]!
    let text: string
    try {
      text = readFileSync(path.join(root, rel), 'utf8')
    } catch {
      continue
    }
    findings.push(...scanGlobLists(text, rel))
  }
  return findings
}

function main(): number {
  const findings = scanRepo()
  if (process.argv.includes('--fix') && findings.length > 0) {
    const files = [...new Set(findings.map(f => f.file))]
    for (let i = 0, { length } = files; i < length; i += 1) {
      const abs = path.join(REPO_ROOT, files[i]!)
      writeFileSync(abs, sortGlobListsInText(readFileSync(abs, 'utf8')))
      logger.log(`sorted glob list(s) in ${files[i]!}`)
    }
    return 0
  }
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify({ findings }, undefined, 2)}\n`)
    return findings.length === 0 ? 0 : 1
  }
  if (findings.length === 0) {
    logger.log('glob lists are sorted')
    return 0
  }
  logger.error(`${findings.length} glob list(s) are not byte-sorted.`)
  logger.group()
  for (const finding of findings) {
    logger.error(`${finding.file}:${finding.line}: ${finding.key}`)
    logger.group()
    logger.error(`saw:  ${finding.saw.join(', ')}`)
    logger.error(`want: ${finding.sorted.join(', ')}`)
    logger.groupEnd()
  }
  logger.groupEnd()
  logger.error(
    'Fix: re-run with --fix, or mark the list `order-matters` when a later pattern must override an earlier one.',
  )
  return 1
}

const SCRIPT_META: ScriptMeta = {
  describe: 'check that every scanned config glob list is byte-sorted',
  help: `Usage: node scripts/fleet/check/glob-lists-are-sorted.mts [flags]
  --fix    rewrite each unsorted glob list in place
  --json   print the findings as JSON`,
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
/* c8 ignore stop */
