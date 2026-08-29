#!/usr/bin/env node
/*
 * @file Mint a handoff document under `.claude/reports/` and print its
 *   ABSOLUTE path.
 *
 *   The absolute path is the product, not a courtesy. Reports live in a
 *   gitignored tree, so `reports/x.md` is unresolvable for anyone who does not
 *   already know which repo the session was rooted in, and a session that
 *   spans several checkouts, which is the normal case here, makes a relative
 *   path actively misleading. The path is printed on stdout ALONE so a caller
 *   can pipe it.
 *
 *   Naming is delegated, not re-derived: `consolidate-reports.mts` owns the
 *   `YYYY-MM-DD-<slug>.md` convention and its slug normalizer, and this script
 *   imports both. One place decides what a report is called.
 *
 *   Refuses to mint a SECOND file for a slug that already exists, printing the
 *   existing absolute path instead. That collision is the exact condition
 *   `consolidate-reports.mts` exists to complain about: two files for one
 *   report, split across saves. `--new` overrides when the second document is
 *   deliberate.
 *
 *   Usage: node scripts/fleet/write-handoff.mts <slug> [--title "..."] [--new]
 *          node scripts/fleet/write-handoff.mts <slug> --path-only
 */

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { normalizeReportSlug } from './consolidate-reports.mts'
import { REPO_ROOT } from './paths.mts'
import { isMainModule } from './_shared/is-main-module.mts'
import { runMain } from './_shared/run-main.mts'

import type { ScriptMeta } from './_shared/run-main.mts'

const logger = getDefaultLogger()

const REPORTS_REL = path.join('.claude', 'reports')

/**
 * The reports directory for `repoRoot`.
 */
export function reportsDir(repoRoot: string): string {
  return path.join(repoRoot, REPORTS_REL)
}

/**
 * A filesystem-safe slug: lowercase, non-alphanumerics collapsed to single
 * hyphens, edges trimmed. `-handoff` is appended when absent so every document
 * this mints is findable by that one substring.
 */
export function toHandoffSlug(raw: string): string {
  const base = raw
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    // Leading or trailing hyphen runs, left by collapsing punctuation at the
    // edges (`--thing--` -> `-thing-`).
    .replaceAll(/^-+|-+$/g, '')
  const trimmed = base || 'session'
  return trimmed.endsWith('-handoff') || trimmed === 'handoff'
    ? trimmed
    : `${trimmed}-handoff`
}

/**
 * Today as `YYYY-MM-DD`, in local time so the name matches the operator's day.
 */
export function todayStamp(now: Date): string {
  const year = now.getFullYear()
  const month = `${now.getMonth() + 1}`.padStart(2, '0')
  const day = `${now.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * The basename this run would write.
 */
export function handoffBasename(slug: string, now: Date): string {
  return `${todayStamp(now)}-${slug}.md`
}

/**
 * An existing report sharing `slug`, ignoring its date prefix, or undefined.
 *
 * Compared through `normalizeReportSlug` so a document saved on another day is
 * still recognized as the same report.
 */
export function findExistingBySlug(
  repoRoot: string,
  slug: string,
): string | undefined {
  const dir = reportsDir(repoRoot)
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return undefined
  }
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const entry = entries[i]!
    if (!entry.endsWith('.md')) {
      continue
    }
    if (normalizeReportSlug(entry) === slug) {
      return path.join(dir, entry)
    }
  }
  return undefined
}

/**
 * The scaffold. Sections are the ones that made a handoff usable in practice:
 * what the reader must not re-derive, what is left, and what will bite. A blank
 * file gets a summary; a scaffold gets a handoff.
 */
export function handoffTemplate(title: string, stamp: string): string {
  return `# ${title}

Written ${stamp}.

## Short version

<the one paragraph a reader needs before anything else: what state the work is
in, and what the next actor should do first>

## What is already done

<so the next session does not redo it, with the evidence that proves it>

## What is left

<the concrete remaining steps, in order>

## Mechanics that will bite

<the traps: ordering constraints, laws that fire, concurrent actors, anything
learned the hard way this session>

## Verification

\`\`\`sh
<the commands that prove the state, so the reader can confirm rather than trust>
\`\`\`

## Also open

<adjacent things noticed but deliberately not done, and why>
`
}

/**
 * Parse argv. Pure.
 */
export function parseHandoffArgs(argv: readonly string[]): {
  force: boolean
  pathOnly: boolean
  slug: string | undefined
  title: string | undefined
} {
  let force = false
  let pathOnly = false
  let slug
  let title
  for (let i = 0, { length } = argv; i < length; i += 1) {
    const arg = argv[i]!
    if (arg === '--new') {
      force = true
    } else if (arg === '--path-only') {
      pathOnly = true
    } else if (arg === '--title') {
      i += 1
      title = argv[i]
    } else if (!arg.startsWith('-') && slug === undefined) {
      slug = arg
    }
  }
  return { force, pathOnly, slug, title }
}

async function main(): Promise<void> {
  const parsed = parseHandoffArgs(process.argv.slice(2))
  if (!parsed.slug) {
    logger.fail(
      'write-handoff: name the handoff - `node scripts/fleet/write-handoff.mts <slug>`.',
    )
    process.exitCode = 1
    return
  }
  const slug = toHandoffSlug(parsed.slug)
  const existing = parsed.force
    ? undefined
    : findExistingBySlug(REPO_ROOT, slug)
  if (existing) {
    // Not an error: the operator asked for this report and it exists. Hand back
    // the path so the next move is to EDIT it, which is what keeps one report
    // one file.
    if (!parsed.pathOnly) {
      logger.warn(
        `write-handoff: a report for \`${slug}\` already exists - edit it, or pass --new for a second document.`,
      )
    }
    process.stdout.write(`${existing}\n`)
    return
  }
  const dir = reportsDir(REPO_ROOT)
  mkdirSync(dir, { recursive: true })
  const now = new Date()
  const absPath = path.join(dir, handoffBasename(slug, now))
  const title =
    parsed.title ??
    slug.replaceAll('-', ' ').replace(/^./, c => c.toUpperCase())
  if (!existsSync(absPath)) {
    writeFileSync(absPath, handoffTemplate(title, todayStamp(now)), 'utf8')
  }
  if (!parsed.pathOnly) {
    logger.success(
      `write-handoff: created ${path.relative(REPO_ROOT, absPath)}`,
    )
  }
  // The absolute path, alone on stdout, always last.
  process.stdout.write(`${absPath}\n`)
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'mints a dated handoff document under .claude/reports and prints its absolute path',
  help: `Usage: node scripts/fleet/write-handoff.mts <slug> [flags]

  <slug>          the report's name; \`-handoff\` is appended when absent
  --title "..."   the document's H1 (default: the slug, prettified)
  --new           mint a second document even if the slug already exists
  --path-only     print only the absolute path, no log lines`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
