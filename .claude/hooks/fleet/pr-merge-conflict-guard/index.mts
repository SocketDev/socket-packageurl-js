#!/usr/bin/env node
// Claude Code PostToolUse hook — pr-merge-conflict-guard.
//
// When the assistant views a PR (`gh pr view`, `gh pr diff`, or
// `gh pr checkout`), this guard asks GitHub whether that PR's branch still
// merges cleanly into its base. A PR with merge conflicts is a dead end for
// review work — the diff GitHub shows is mixed with conflict markers, a
// checkout lands a broken tree, and any comment is left against a state that
// will never merge — so the guard BLOCKS the moment one is opened, with the
// fix in hand, instead of letting the session drill into a stale view.
//
// What it BLOCKS (exit 2):
//   - `gh pr view|diff|checkout <n>` against a PR whose `mergeable` is
//     `CONFLICTING`. The message names the PR, its base, and the two ways
//     to resolve (rebase the PR branch onto its base, or merge the base in),
//     and defers to odai (SocketDev/odai) to resolve the conflict if
//     possible — odai can read the conflict markers and propose the
//     resolution.
//
// What it NOTIFIES (stderr, exit 0 — the tool call proceeds):
//   - `mergeable === null` — GitHub is still computing mergeability. The
//     guard emits a non-blocking notice suggesting a re-check rather than
//     guessing, because `null` is transient and reads as neither clean nor
//     conflicting.
//
// What it ALLOWS (silent, undefined):
//   - `mergeable === 'MERGEABLE'` — the PR merges cleanly, view away.
//   - Any non-`gh pr view|diff|checkout` command.
//
// FAILS OPEN on every error path: no `gh` on PATH, no parseable PR
// number/repo, a network blip, a `gh` non-zero exit, or unparseable JSON —
// the guard enforces a review-hygiene contract, it must never block a
// session over GitHub availability or a misread command. The runner's own
// fail-open wraps a thrown `GuardResult`; the throw paths in this module
// additionally return `undefined` so a parse/spawn error inside `check`
// never reaches the runner as a block.

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  bashGuard,
  block,
  defineHook,
  notify,
  runHook,
} from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import {
  ghExplicitRepoArg,
  normalizeRepoSlug,
} from '../_shared/gh-target-repo.mts'
import { resolveProjectPath } from '../_shared/paths.mts'
import { commandsFor } from '../_shared/shell-command.mts'
import { spawnTimeoutMs } from '../_shared/spawn-timeout.mts'

const NAME = 'pr-merge-conflict-guard'

// The `gh pr` verbs that READ or CHECK OUT a PR — the moment to insist on a
// clean merge. `create`/`comment`/`merge`/`edit` are intentionally absent: a
// merge is its own conflict resolver, and a comment can land on a conflicted
// PR (the reviewer may be commenting ON the conflict).
const PR_VIEW_VERBS: ReadonlySet<string> = new Set(['checkout', 'diff', 'view'])

// Pre-flight trigger: the dispatcher skips importing this hook unless one of
// these substrings appears in the raw Bash command. Specific to the three
// verbs this guard owns so a `gh pr create`/`gh pr comment` never pays the
// import, and a prose mention of "pr view" inside a grep string never reaches
// the parser (commandsFor tokenizes through shell quoting).
export const triggers: readonly string[] = [
  'gh pr view',
  'gh pr diff',
  'gh pr checkout',
]

export interface PrTarget {
  readonly number: number
  // OWNER/REPO — resolved from `--repo`/`-R`, else this checkout's origin.
  readonly repo: string
}

// OWNER/REPO of this checkout's origin, or '' when origin is unreadable.
function originSlug(cwd: string): string {
  const r = spawnSync('git', ['remote', 'get-url', 'origin'], {
    cwd,
    stdio: 'pipe',
    timeout: spawnTimeoutMs(5000),
  })
  if (r.error || r.status !== 0) {
    return ''
  }
  return normalizeRepoSlug(String(r.stdout).trim())
}

/**
 * Every `gh pr view|diff|checkout <n> [--repo <owner/repo>]` target in the
 * command. Rides the shell-quote-backed AST parser (`commandsFor`), never a
 * raw regex, so `&&` chains, quoting, and `$(…)` substitution are handled and
 * a literal "gh pr view" inside a grep string can't false-fire.
 *
 * A bare number with no resolvable owner/repo (`--repo` absent AND no origin
 * remote) is dropped — the live mergeability query needs a repo to address.
 */
export function extractPrTargets(command: string, cwd: string): PrTarget[] {
  const out: PrTarget[] = []
  const seen = new Set<string>()
  const ghCmds = commandsFor(command, 'gh')
  for (let i = 0, { length } = ghCmds; i < length; i += 1) {
    const args = ghCmds[i]!.args
    if (args[0] !== 'pr' || !PR_VIEW_VERBS.has(args[1] ?? '')) {
      continue
    }
    // The PR number is the first numeric token after the verb. A `--repo`
    // value can't be numeric, so this never collides with the flag.
    const num = args.slice(2).find(a => /^\d+$/.test(a))
    if (!num) {
      continue
    }
    const explicit = normalizeRepoSlug(ghExplicitRepoArg(args))
    const repo = explicit || originSlug(cwd)
    if (!repo) {
      continue
    }
    const key = `${repo}#${num}`
    if (!seen.has(key)) {
      seen.add(key)
      out.push({ number: Number(num), repo })
    }
  }
  return out
}

interface PrMergeableJson {
  readonly number?: number | undefined
  readonly title?: string | undefined
  // GitHub's `mergeable`: 'MERGEABLE', 'CONFLICTING', or null (still
  // computing). The field is null RIGHT after a push and flips to a value
  // once GitHub recomputes — transient, hence the notify arm.
  readonly mergeable?: 'MERGEABLE' | 'CONFLICTING' | null | undefined
  readonly mergeStateStatus?: string | undefined
  readonly headRefName?: string | undefined
  readonly baseRefName?: string | undefined
}

// Live mergeability for one PR, or undefined on any gh / parse failure (fail
// open). Bounded by spawnTimeoutMs so a network blackout can't hang the
// PostToolUse hook.
function ghPrMergeable(pr: PrTarget): PrMergeableJson | undefined {
  const r = spawnSync(
    'gh',
    [
      'pr',
      'view',
      String(pr.number),
      '--repo',
      pr.repo,
      '--json',
      'number,title,mergeable,mergeStateStatus,headRefName,baseRefName',
    ],
    { stdio: 'pipe', timeout: spawnTimeoutMs(15_000) },
  )
  if (r.error || r.status !== 0 || typeof r.stdout !== 'string') {
    return undefined
  }
  try {
    return JSON.parse(r.stdout) as PrMergeableJson
  } catch {
    return undefined
  }
}

export const check = bashGuard((command, payload): GuardResult => {
  const cwd = resolveProjectPath(
    typeof payload.cwd === 'string' ? payload.cwd : undefined,
  )
  let targets: PrTarget[]
  try {
    targets = extractPrTargets(command, cwd)
  } catch {
    // A parser throw must never block — fail open.
    return undefined
  }
  if (targets.length === 0) {
    return undefined
  }
  for (let i = 0, { length } = targets; i < length; i += 1) {
    const pr = targets[i]!
    let data: PrMergeableJson | undefined
    try {
      data = ghPrMergeable(pr)
    } catch {
      // A spawn throw must never block — fail open.
      continue
    }
    if (!data) {
      // gh unavailable / PR not found / unparseable JSON — fail open.
      continue
    }
    const mergeable = data.mergeable
    if (mergeable === 'CONFLICTING') {
      const base = data.baseRefName ?? '<base>'
      return block(
        [
          `${NAME}: PR ${pr.repo}#${pr.number}` +
            (data.title ? ` (${data.title})` : '') +
            ` has merge conflicts with its base branch (${base}) - resolve them before continuing.`,
          `Fix: git fetch origin && git rebase origin/${base}, then git push.`,
        ].join('\n'),
      )
    }
    if (mergeable === null) {
      return notify(
        `${NAME}: GitHub is still computing mergeability for PR ${pr.repo}#${pr.number} - re-check before relying on it.`,
      )
    }
    // 'MERGEABLE' → allow (undefined). Any other unexpected value also falls
    // through to allow — fail open on a shape GitHub didn't document.
  }
  return undefined
})

export const hook = defineHook({
  check,
  event: 'PostToolUse',
  matcher: ['Bash'],
  triggers,
  type: 'guard',
})

void runHook(hook, import.meta.url)
