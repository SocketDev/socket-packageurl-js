#!/usr/bin/env node
// Claude Code PreToolUse hook — no-unasked-non-fleet-pr-guard.
//
// Blocks `gh pr create` against a repository that is NOT a fleet member until
// the operator has said yes for that repo. Pushing the branch stays free; it is
// opening the PR that needs a word, because in someone else's repo a PR is not
// a private artifact: it summons reviewers, spends their CI, notifies
// CODEOWNERS, and cannot be taken back cleanly — GitHub's reopen can refuse
// outright, so "just close it" is not a safe undo.
//
// Why non-fleet specifically: inside the fleet, opening a PR is how work lands
// and the roster repos are ours to churn. Outside it the agent is a guest. A
// "do it" about the WORK gets read as authorization to FILE, which is how two
// unrequested PRs landed on a team repo (2026-08-10) — one of which belonged in
// the fleet template rather than in that product at all. The move there was:
// push the branch, describe the PR, wait.
//
// Detection rides the shared `gh pr create` parser
// (`_shared/gh-pr-command.mts`), never a regex, so `&&` chains, quoting, and a
// literal "gh pr create" inside a `--body` cannot false-fire. Drafts count: a
// draft still creates the PR and its notifications.
//
// `gh pr create` is not the only way to open a PR, and a guard that covers
// just it teaches the agent to route around the guard, so the other two
// vectors are covered too:
//   - REST: `gh api repos/{owner}/{repo}/pulls` with an explicit `-X POST`,
//     or with `-f`/`-F` fields (which make gh POST implicitly). An explicit
//     `-X GET` stays read-only. The endpoint path names the target repo, so
//     detection and target resolution come from the same argument.
//   - GraphQL: `gh api graphql` whose arguments carry `createPullRequest`.
//     The mutation takes a repository node id, not a slug, so the target
//     falls back to the origin of the directory the command runs in — and,
//     unresolvable, fails OPEN like the base case.
// `hub pull-request` is intentionally NOT covered: hub is not installed on
// fleet machines, and an agent inventive enough to install it has more
// general supply-chain guards to answer to first.
//
// Target resolution, in priority order:
//   1. `--repo` / `-R owner/name` on the command
//   2. the REST endpoint's `{owner}/{repo}` path segments
//   3. the origin remote of the directory the command runs in (`cd x && gh …`,
//      else the session cwd)
//
// Fires everywhere via `global: true` — a non-fleet repo is exactly where this
// has to work, so it cannot be scoped to fleet checkouts.
//
// Bypass: `Allow non-fleet-pr bypass: <repo>` typed verbatim in a recent user
// turn. The scoped form names one repo, so a yes for one cannot leak to another.
//
// Fails OPEN on ambiguity (no parseable command, no resolvable repo): a guard
// that blocks a legitimate PR is worse than one that misses a case.

import path from 'node:path'

import {
  acceptedScopedBypassPhrases,
  isFleetRepo,
  originOwnerRepo,
  originSlug,
} from '../_shared/fleet-repos.mts'
import { ghPrCreateCommand, isGhPrCreate } from '../_shared/gh-pr-command.mts'
import {
  ghExplicitRepoArg,
  normalizeRepoSlug,
} from '../_shared/gh-target-repo.mts'
import { extractGitCwd } from '../_shared/git-cwd.mts'
import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import { commandsFor } from '../_shared/shell-command.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

// Dispatcher pre-flight: every command this guard can care about carries `gh`.
export const triggers: readonly string[] = ['gh']

const BYPASS_PHRASE = 'Allow non-fleet-pr bypass'
const BYPASS_PHRASE_PREFIX = 'Allow non-fleet-pr bypass:'

/**
 * The bare repo slug of an `owner/name` argument: `SocketDev/x` → `x`.
 */
export function bareSlug(ownerRepo: string): string {
  const tail = normalizeRepoSlug(ownerRepo).split('/').pop()
  return (tail ?? '').toLowerCase()
}

export interface PrRepoTarget {
  /**
   * `owner/name` when known, else '' — for messages and scoped phrases.
   */
  readonly ownerRepo: string
  /**
   * Bare lowercase slug, the key fleet membership is decided on, or ''.
   */
  readonly slug: string
}

/**
 * The repo a `gh pr create` would open against. Empty fields when unresolved.
 */
export function prTargetRepo(
  command: string,
  cwd?: string | undefined,
): PrRepoTarget {
  const parsed = ghPrCreateCommand(command)
  const explicit = parsed ? ghExplicitRepoArg(parsed.args) : ''
  if (explicit) {
    return { ownerRepo: normalizeRepoSlug(explicit), slug: bareSlug(explicit) }
  }
  const dir = extractGitCwd(command, cwd === undefined ? undefined : { cwd })
  return { ownerRepo: originOwnerRepo(dir) ?? '', slug: originSlug(dir) ?? '' }
}

// `repos/{owner}/{repo}/pulls`, optionally leading-slash / trailing-slash —
// the REST endpoint that creates a PR when POSTed. The endpoint argument
// names the target, so one match serves detection and target resolution.
const PULLS_ENDPOINT = /^\/?repos\/([^/\s]+)\/([^/\s]+)\/pulls\/?$/i

/**
 * True when a parsed `gh api` argv writes rather than reads. An explicit
 * `-X` / `--method` wins either way (an explicit `-X GET` on the pulls
 * endpoint is a list, not a create); with no method flag, `-f` / `-F`
 * fields make gh POST implicitly.
 */
export function ghApiCallIsWrite(args: readonly string[]): boolean {
  for (let i = 0, { length } = args; i < length; i += 1) {
    const arg = args[i]!
    if (arg === '--method' || arg === '-X') {
      return (args[i + 1] ?? '').toUpperCase() === 'POST'
    }
    if (arg.startsWith('-X=') || arg.startsWith('--method=')) {
      return arg.slice(arg.indexOf('=') + 1).toUpperCase() === 'POST'
    }
  }
  return args.some(
    a =>
      a === '-f' ||
      a === '-F' ||
      a === '--field' ||
      a === '--raw-field' ||
      a.startsWith('-f=') ||
      a.startsWith('-F=') ||
      a.startsWith('--field=') ||
      a.startsWith('--raw-field='),
  )
}

/**
 * The repo a `gh api repos/{owner}/{repo}/pulls` POST would open a PR
 * against, or undefined when the command is not a REST PR-create.
 */
export function ghApiRestPrCreate(command: string): PrRepoTarget | undefined {
  for (const c of commandsFor(command, 'gh')) {
    const { args } = c
    if (args[0] !== 'api') {
      continue
    }
    const endpoint = args.find(a => PULLS_ENDPOINT.test(a))
    if (!endpoint || !ghApiCallIsWrite(args)) {
      continue
    }
    const match = PULLS_ENDPOINT.exec(endpoint)!
    const ownerRepo = `${match[1]}/${match[2]}`
    return { ownerRepo, slug: bareSlug(ownerRepo) }
  }
  return undefined
}

/**
 * True when the command is a `gh api graphql` call whose arguments carry a
 * `createPullRequest` mutation. The mutation's repository is a node id, not
 * a slug, so the caller resolves the target from the working directory.
 */
export function isGhApiGraphqlPrCreate(command: string): boolean {
  return commandsFor(command, 'gh').some(
    c =>
      c.args[0] === 'api' &&
      c.args.includes('graphql') &&
      c.args.some(a => a.includes('createPullRequest')),
  )
}

/**
 * Phrases that authorize a PR against `targets`: the scoped forms plus the bare
 * session-wide one. The shared matcher keeps the bare form from matching inside
 * a scoped grant, so a yes narrowed to one repo stays narrowed.
 */
export function acceptedBypassPhrases(
  targets: ReadonlyArray<string | undefined>,
): string[] {
  return acceptedScopedBypassPhrases(BYPASS_PHRASE, targets)
}

// A per-operator allowlist of non-fleet repos that may be PR'd without the
// scoped bypass phrase — for the repos a contributor regularly files against
// that are not SocketDev fleet members (an upstream they contribute to, their
// own forks). Kept OUT of the shared fleet roster JSON (those are SocketDev
// repos only); this is a personal knob, set in the operator's
// `~/.claude/settings.json` env block. Comma-separated `owner/repo` entries
// and `owner/*` globs, case-insensitive: `CLAUDE_NON_FLEET_PR_ALLOW=jdalton/*,nubjs/*,jdx/aube`.
// The guard still blocks a PR on a random third-party repo not on the list.
const NON_FLEET_PR_ALLOW_ENV = 'CLAUDE_NON_FLEET_PR_ALLOW'

/**
 * True when `ownerRepo` (`owner/name`, case-insensitive) matches an
 * `owner/repo` entry or `owner/*` glob in the `CLAUDE_NON_FLEET_PR_ALLOW` env
 * var. False when the env var is unset/empty or `ownerRepo` is empty. Matching
 * is on `owner/repo` only — a bare repo slug is NOT matched, so an `aube` entry
 * cannot authorize every fork's `aube`.
 */
export function envAllowedNonFleet(ownerRepo: string): boolean {
  const raw = process.env[NON_FLEET_PR_ALLOW_ENV]
  if (!raw || !ownerRepo) {
    return false
  }
  const target = ownerRepo.toLowerCase()
  const entries = raw.split(',')
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const pat = entries[i]!.trim().toLowerCase()
    if (!pat) {
      continue
    }
    if (pat === target) {
      return true
    }
    if (pat.endsWith('/*') && target.startsWith(pat.slice(0, -1))) {
      return true
    }
  }
  return false
}

export const check = bashGuard((command, payload) => {
  // The invocation form decides how the target is found: REST names it in
  // the endpoint path, `gh pr create` uses --repo/cwd, and GraphQL falls
  // back to cwd (its repository argument is a node id, not a slug).
  const restTarget = ghApiRestPrCreate(command)
  const graphql = restTarget === undefined && isGhApiGraphqlPrCreate(command)
  const prCreate = restTarget === undefined && !graphql && isGhPrCreate(command)
  if (restTarget === undefined && !graphql && !prCreate) {
    return undefined
  }
  const { ownerRepo, slug } = restTarget ?? prTargetRepo(command)
  if (!slug) {
    return undefined
  }
  if (isFleetRepo(slug)) {
    return undefined
  }
  // Per-operator allowlist (CLAUDE_NON_FLEET_PR_ALLOW) — regular non-fleet
  // contribution targets the operator has opted in, so they don't need the
  // scoped bypass phrase on every PR. See `envAllowedNonFleet`.
  if (envAllowedNonFleet(ownerRepo)) {
    return undefined
  }
  const targets = [slug, ownerRepo, path.basename(extractGitCwd(command))]
  if (
    payload.transcript_path &&
    bypassPhrasePresent(payload.transcript_path, acceptedBypassPhrases(targets))
  ) {
    return undefined
  }
  const label = ownerRepo || slug
  const via = restTarget
    ? 'gh api (REST)'
    : graphql
      ? 'gh api graphql'
      : 'gh pr create'
  return block(
    [
      `no-unasked-non-fleet-pr-guard: opening a PR on non-fleet repo ${label} via ${via} needs a yes first - it summons reviewers and CI you don't own, and closing it is not a clean undo.`,
      'Fix: leave the branch pushed, describe the PR (title, change, target repo), and wait for the operator.',
      `Bypass (the user must type verbatim in a recent turn): \`${BYPASS_PHRASE_PREFIX} ${label}\` (or the session-wide \`${BYPASS_PHRASE}\`)`,
    ].join('\n'),
  )
})

export const hook = defineHook({
  bypass: ['non-fleet-pr'],
  bypassMode: 'manual',
  check,
  event: 'PreToolUse',
  global: true,
  matcher: ['Bash'],
  type: 'guard',
})

void runHook(hook, import.meta.url)
