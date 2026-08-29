#!/usr/bin/env node
/**
 * @file Files what the weekly fuzz run found, so a crash is a tracked issue
 *   rather than a red square nobody opens.
 *   Fuzzing moved off the per-commit path: a randomized harness is budgeted by
 *   wall-clock, so whether it crashes depends on how loaded the runner was, and
 *   a gate that flakes by machine load gets ignored. The cost of a scheduled
 *   run is that nobody watches it, which this closes — a failing leg opens an
 *   issue naming the leg, the run, and the commit.
 *   ONE OPEN ISSUE PER LEG. A weekly job that files unconditionally produces
 *   52 duplicates a year for one unfixed crash, so an existing open issue for
 *   the same leg gets a comment instead. The title marker is the dedupe key
 *   because it survives edits to the body, and no label is required: a label
 *   that does not exist in a member repo makes `gh issue create` fail, which
 *   would turn a reported crash into a silent one.
 *   Usage:
 *   node scripts/fleet/fuzz/report-crash.mts --leg <name> [--run-url <url>]
 *   [--sha <sha>] [--dry-run]
 */

import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

/**
 * The marker every fuzz-crash issue title starts with. Searched for verbatim,
 * so changing it orphans the issues already filed under the old one.
 */
export const TITLE_MARKER = '[fuzz]'

/**
 * The dedupe key for one fuzz leg: `[fuzz] <leg> is crashing`. Two runs of the
 * same leg share a title, so the second comments on the first's issue.
 */
export function issueTitle(leg: string): string {
  return `${TITLE_MARKER} ${leg} is crashing`
}

export interface CrashContext {
  readonly leg: string
  readonly runUrl?: string | undefined
  readonly sha?: string | undefined
}

/**
 * The issue body. Pure, so the wording is testable without a network call.
 */
export function issueBody(context: CrashContext): string {
  const ctx = { __proto__: null, ...context } as CrashContext
  const lines = [`The \`${ctx.leg}\` leg of the weekly fuzz run failed.`, '']
  if (ctx.runUrl) {
    lines.push(`Run: ${ctx.runUrl}`)
  }
  if (ctx.sha) {
    lines.push(`Commit: ${ctx.sha}`)
  }
  lines.push(
    '',
    'A crashing input is uploaded as a run artifact. The protocol is to',
    'reproduce it locally, fix the crash, then commit the minimized input as a',
    'regression test so the same bug cannot return unnoticed.',
    '',
    'Fuzzing does not run per commit, so this was found by the schedule rather',
    'than by whoever introduced it — the commit above is where the run landed,',
    'not necessarily the cause.',
  )
  return lines.join('\n')
}

/**
 * The comment left when a leg is still crashing and its issue is already open.
 */
export function recurrenceComment(context: CrashContext): string {
  const ctx = { __proto__: null, ...context } as CrashContext
  const parts = ['Still crashing on the latest weekly fuzz run.']
  if (ctx.runUrl) {
    parts.push(`Run: ${ctx.runUrl}`)
  }
  if (ctx.sha) {
    parts.push(`Commit: ${ctx.sha}`)
  }
  return parts.join('\n')
}

export interface OpenIssue {
  readonly number: number
  readonly title: string
}

export type CrashAction =
  | { readonly kind: 'comment'; readonly issue: number }
  | { readonly kind: 'create' }

/**
 * Whether to open a new issue for `leg` or comment on the one already tracking
 * it. Pure over the open-issue list, so the dedupe rule is testable without
 * touching GitHub.
 *
 * Matched on the EXACT title. A substring match would fold two legs into one
 * when one name is a prefix of another (`fuzz-go` inside `fuzz-go-extra`), and
 * the second leg's crash would then be filed as a comment on the first's
 * issue, where nobody is looking for it.
 */
export function chooseAction(
  openIssues: readonly OpenIssue[],
  leg: string,
): CrashAction {
  const wanted = issueTitle(leg)
  for (let i = 0, { length } = openIssues; i < length; i += 1) {
    const issue = openIssues[i]!
    if (issue.title === wanted) {
      return { kind: 'comment', issue: issue.number }
    }
  }
  return { kind: 'create' }
}

/**
 * Parse `gh issue list --json number,title` output. Tolerant by design: a
 * malformed or empty answer yields no issues, which files a fresh issue rather
 * than swallowing the crash report.
 */
export function parseOpenIssues(json: string): OpenIssue[] {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    return []
  }
  if (!Array.isArray(data)) {
    return []
  }
  const out: OpenIssue[] = []
  for (let i = 0, { length } = data; i < length; i += 1) {
    const entry = data[i] as {
      number?: unknown | undefined
      title?: unknown | undefined
    }
    if (typeof entry?.number === 'number' && typeof entry?.title === 'string') {
      out.push({ number: entry.number, title: entry.title })
    }
  }
  return out
}

export function parseCli(argv: readonly string[]): {
  dryRun: boolean
  leg: string
  runUrl: string | undefined
  sha: string | undefined
} {
  const read = (flag: string): string | undefined => {
    const at = argv.indexOf(flag)
    if (at !== -1 && argv[at + 1] !== undefined) {
      return argv[at + 1]
    }
    const prefix = `${flag}=`
    for (let i = 0, { length } = argv; i < length; i += 1) {
      const arg = argv[i]!
      if (arg.startsWith(prefix)) {
        return arg.slice(prefix.length)
      }
    }
    return undefined
  }
  return {
    dryRun: argv.includes('--dry-run'),
    leg: read('--leg') ?? 'unknown',
    runUrl: read('--run-url'),
    sha: read('--sha'),
  }
}

function gh(args: readonly string[], input?: string | undefined): string {
  const result = spawnSync('gh', args as string[], {
    stdioString: true,
    ...(input === undefined ? {} : { input }),
  })
  return result.status === 0 ? String(result.stdout ?? '') : ''
}

async function main(): Promise<void> {
  const opts = parseCli(process.argv.slice(2))
  const context: CrashContext = {
    leg: opts.leg,
    runUrl: opts.runUrl,
    sha: opts.sha,
  }
  const action = chooseAction(
    parseOpenIssues(
      gh([
        'issue',
        'list',
        '--state',
        'open',
        '--search',
        TITLE_MARKER,
        '--json',
        'number,title',
        '--limit',
        '100',
      ]),
    ),
    opts.leg,
  )
  if (opts.dryRun) {
    logger.log(
      action.kind === 'create'
        ? `report-crash: would open "${issueTitle(opts.leg)}".`
        : `report-crash: would comment on #${action.issue}.`,
    )
    return
  }
  if (action.kind === 'comment') {
    gh(
      ['issue', 'comment', String(action.issue), '--body-file', '-'],
      recurrenceComment(context),
    )
    logger.log(`report-crash: commented on #${action.issue}.`)
    return
  }
  gh(
    ['issue', 'create', '--title', issueTitle(opts.leg), '--body-file', '-'],
    issueBody(context),
  )
  logger.log(`report-crash: opened "${issueTitle(opts.leg)}".`)
}

const SCRIPT_META: ScriptMeta = {
  describe: 'files or updates the issue tracking a crashing fuzz leg',
  help: `Usage: node scripts/fleet/fuzz/report-crash.mts [flags]
  --leg <name>      the failing job leg (required in practice)
  --run-url <url>   link to the workflow run
  --sha <sha>       the commit the run used
  --dry-run         print the decision without touching GitHub`,
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
/* c8 ignore stop */
