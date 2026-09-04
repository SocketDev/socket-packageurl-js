#!/usr/bin/env node
// Claude Code Stop hook — branch-worktree-sweep-nudge.
//
// Fires at turn-end. Scans the current repo for stale git worktrees and
// redundant/superseded local branches, and nudges the operator to clean
// them up. Reminder-only (notify, never block) — deleting branches and
// worktrees is destructive and the operator decides; the guard makes it
// a decision rather than a default, and bakes in the "verify before
// delete" rule.
//
// What's flagged:
//
//   1. Stale worktrees — merged branches, gone directories, old detached
//      HEADs, or git-marked prunable. Nudges `git worktree remove` /
//      `git worktree prune`.
//   2. Redundant branches — local branches with no live upstream whose
//      content is contained in the default branch. Nudges `git branch -d`
//      or `-D`.
//   3. The verify-before-delete rule (the headline) — for branches flagged
//      as redundant, content-containment PROOF is required, not just
//      commit ancestry. A squash-merge rewrites commits, so
//      `git merge-base --is-ancestor` returns false for genuinely-merged
//      work. The correct check is a tree/content diff: every file the
//      branch changed must be byte-identical in the kept branch. If
//      containment can't be proven, the nudge says "verify content
//      containment before deleting" rather than "safe to delete."
//
// What's NEVER touched:
//
//   - The primary checkout (first worktree in `git worktree list`)
//   - A worktree with uncommitted/staged changes
//   - The current branch or the default branch
//   - A locked worktree
//
// Silent on the happy path. When something is found, notifies with the
// cleanup commands. Never blocks — exit 0 always. Fail-open on any error.
//
// Stop hooks receive JSON on stdin, which this hook never reads; exit
// code is advisory.

import { existsSync } from 'node:fs'
import process from 'node:process'

import { defineHook, notify, runHook } from '../_shared/guard.mts'
import { VERDICT_GLYPHS } from '../_shared/verdict.mts'
import {
  currentBranch,
  gitOut,
  resolveDefaultBranch,
} from '../_shared/git-branch.mts'

// A detached HEAD older than this (seconds) is considered stale.
const DETACHED_HEAD_MAX_AGE_DAYS = 7
const DETACHED_HEAD_MAX_AGE_SEC = DETACHED_HEAD_MAX_AGE_DAYS * 24 * 60 * 60

interface WorktreeEntry {
  path: string
  head: string
  branch?: string | undefined
  branchName?: string | undefined
  detached: boolean
  locked: boolean
  prunable: boolean
}

interface StaleWorktree {
  path: string
  branch?: string | undefined
  detached: boolean
  reason: 'gone' | 'merged' | 'detached-stale' | 'prunable'
}

interface RedundantBranch {
  name: string
  containment: 'ancestry' | 'content-verified' | 'unverified'
}

/**
 * True when `branch` is an ancestor of `ancestorOf` — every commit on
 * `branch` is reachable from `ancestorOf`. Uses exit code (0 = yes,
 * non-0 = no), so `gitOut` returning `undefined` means "not an ancestor."
 */
export function isAncestor(
  repoDir: string,
  branch: string,
  ancestorOf: string,
): boolean {
  return (
    gitOut(repoDir, ['merge-base', '--is-ancestor', branch, ancestorOf]) !==
    undefined
  )
}

/**
 * Check whether `branch`'s content is fully contained in `keptBranch`.
 *
 * This is the squash-merge-safe containment check — the headline logic.
 * `git merge-base --is-ancestor` returns false after a squash-merge (the
 * commits were rewritten into a single new commit), so ancestry alone
 * can't prove a branch is safe to delete. This function compares the
 * actual tree content: for every file the branch changed (relative to
 * the merge-base), the branch's version must match the kept branch's
 * version. If it does, the branch's work is in the kept branch regardless
 * of commit topology.
 *
 * The check is a two-step git diff:
 *
 * 1. `git diff --name-only <merge-base>..<branch>` — files the branch touched.
 * 2. `git diff <branch>..<keptBranch> -- <files>` — compares the two branch TIPS
 *    for those files. Empty output means byte-identical.
 *
 * Returns true when the branch changed nothing (trivially contained) or
 * every changed file is byte-identical in the kept branch. Returns false
 * when no merge-base exists or any changed file differs — the squash-drop
 * case where the squash silently dropped part of the work.
 */
export function isContentContained(
  repoDir: string,
  branch: string,
  keptBranch: string,
): boolean {
  const mergeBase = gitOut(repoDir, ['merge-base', branch, keptBranch])
  if (!mergeBase) {
    return false
  }
  const changedFiles = gitOut(repoDir, [
    'diff',
    '--name-only',
    `${mergeBase}..${branch}`,
  ])
  if (!changedFiles) {
    // Branch changed nothing relative to merge-base — trivially contained.
    return true
  }
  const files = changedFiles.split(/\r?\n/).filter(Boolean)
  // `git diff branch..keptBranch -- <files>` compares the TIPS of the two
  // branches for the files the branch touched. Empty output means the files
  // are byte-identical in both tips — the branch's content is in the kept
  // branch, regardless of how it got there (merge, squash-merge, cherry-pick).
  const diff = gitOut(repoDir, [
    'diff',
    `${branch}..${keptBranch}`,
    '--',
    ...files,
  ])
  return diff === ''
}

// Unix timestamp (seconds since epoch) of a commit, or undefined on failure.
function commitAgeSeconds(repoDir: string, sha: string): number | undefined {
  const ts = gitOut(repoDir, ['show', '-s', '--format=%ct', sha])
  if (!ts) {
    return undefined
  }
  const num = Number.parseInt(ts, 10)
  return Number.isFinite(num) ? num : undefined
}

/**
 * Parse `git worktree list --porcelain` output into structured entries.
 * Each entry starts with `worktree <path>`, followed by `HEAD <sha>`, then
 * `branch refs/heads/<name>` or `detached`, optionally `locked` /
 * `prunable`. Entries are separated by blank lines.
 */
export function parseWorktreeList(output: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = []
  const lines = output.split(/\r?\n/)
  let current: Partial<WorktreeEntry> | undefined
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (line.startsWith('worktree ')) {
      if (current) {
        entries.push(current as WorktreeEntry)
      }
      current = {
        path: line.slice('worktree '.length),
        head: '',
        detached: false,
        locked: false,
        prunable: false,
      }
      continue
    }
    if (!current) {
      continue
    }
    if (line.startsWith('HEAD ')) {
      current.head = line.slice('HEAD '.length)
    } else if (line === 'detached') {
      current.detached = true
    } else if (line.startsWith('branch ')) {
      const ref = line.slice('branch '.length)
      current.branch = ref
      current.branchName = ref.replace(/^refs\/heads\//, '')
    } else if (line === 'locked') {
      current.locked = true
    } else if (line === 'prunable') {
      current.prunable = true
    } else if (line === '') {
      entries.push(current as WorktreeEntry)
      current = undefined
    }
  }
  if (current) {
    entries.push(current as WorktreeEntry)
  }
  return entries
}

/**
 * Why one worktree counts as stale, or `undefined` when it is still live.
 * Dirty worktrees are never stale — uncommitted work is never swept.
 */
function classifyStaleWorktree(
  entry: WorktreeEntry,
  repoDir: string,
  defaultBranch: string,
): StaleWorktree | undefined {
  // Directory gone — stale, nudge to prune.
  if (!existsSync(entry.path)) {
    return { path: entry.path, detached: entry.detached, reason: 'gone' }
  }
  // Skip worktrees with uncommitted changes — never touch dirty work.
  if (gitOut(entry.path, ['status', '--porcelain'])) {
    return undefined
  }
  // Git already marked it prunable.
  if (entry.prunable) {
    return {
      path: entry.path,
      branch: entry.branchName,
      detached: entry.detached,
      reason: 'prunable',
    }
  }
  // Branch merged into default — safe to remove.
  if (
    entry.branchName &&
    isAncestor(repoDir, entry.branchName, defaultBranch)
  ) {
    return {
      path: entry.path,
      branch: entry.branchName,
      detached: false,
      reason: 'merged',
    }
  }
  // Detached HEAD older than threshold.
  if (entry.detached && entry.head) {
    const age = commitAgeSeconds(repoDir, entry.head)
    const now = Math.floor(Date.now() / 1000)
    if (age !== undefined && now - age > DETACHED_HEAD_MAX_AGE_SEC) {
      return { path: entry.path, detached: true, reason: 'detached-stale' }
    }
  }
  return undefined
}

/**
 * Find stale worktrees that are safe to remove. Never touches the primary
 * checkout, the session's own worktree, locked worktrees, or worktrees
 * with uncommitted changes.
 */
export function findStaleWorktrees(
  repoDir: string,
  defaultBranch: string,
): StaleWorktree[] {
  const output = gitOut(repoDir, ['worktree', 'list', '--porcelain'])
  if (!output) {
    return []
  }
  const entries = parseWorktreeList(output)
  const sessionDir = process.env['CLAUDE_PROJECT_DIR'] ?? repoDir
  const stale: StaleWorktree[] = []
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const entry = entries[i]!
    // The first entry is always the primary checkout (per git docs), the
    // session's own worktree is in use, and a locked one was locked on
    // purpose.
    if (i === 0 || entry.path === sessionDir || entry.locked) {
      continue
    }
    const classified = classifyStaleWorktree(entry, repoDir, defaultBranch)
    if (classified) {
      stale.push(classified)
    }
  }
  return stale
}

/**
 * Find local branches that are redundant — their content is contained in
 * the default branch and they have no live upstream tracking branch.
 *
 * Each branch is classified by how containment was proven:
 * - 'ancestry': git merge-base --is-ancestor returned true (fast path).
 * - 'content-verified': ancestry failed but the content diff is empty
 * (squash-merge detected — the commits were rewritten but the content
 * is in the default branch).
 * - 'unverified': neither ancestry nor content containment could be
 * proven — the branch has unique content NOT in the default branch.
 * The nudge says "verify content containment before deleting" rather
 * than "safe to delete." This is the squash-drop guard: a squash that
 * silently dropped part of the work.
 */
export function findRedundantBranches(
  repoDir: string,
  defaultBranch: string,
): RedundantBranch[] {
  // Verify the default branch exists locally — if not, nothing to compare
  // against.
  const defaultExists =
    gitOut(repoDir, [
      'show-ref',
      '--verify',
      '--quiet',
      `refs/heads/${defaultBranch}`,
    ]) !== undefined
  if (!defaultExists) {
    return []
  }
  const output = gitOut(repoDir, [
    'for-each-ref',
    '--format=%(refname:short)\t%(upstream:short)\t%(upstream:track)',
    'refs/heads/',
  ])
  if (!output) {
    return []
  }
  const current = currentBranch(repoDir)
  const redundant: RedundantBranch[] = []
  const lines = output.split(/\r?\n/)
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (!line) {
      continue
    }
    const parts = line.split('\t')
    const branch = parts[0]
    const upstream = parts[1] ?? ''
    const track = parts[2] ?? ''
    if (!branch) {
      continue
    }
    // Skip the default branch and the current branch.
    if (branch === defaultBranch || branch === current) {
      continue
    }
    // Only consider branches with no upstream or a gone upstream. A branch
    // with a live remote upstream is actively tracking — likely in use.
    const hasLiveUpstream = Boolean(upstream) && !track.includes('[gone]')
    if (hasLiveUpstream) {
      continue
    }
    // Fast path: ancestry check.
    if (isAncestor(repoDir, branch, defaultBranch)) {
      redundant.push({ name: branch, containment: 'ancestry' })
      continue
    }
    // Squash-merge path: content containment check.
    if (isContentContained(repoDir, branch, defaultBranch)) {
      redundant.push({ name: branch, containment: 'content-verified' })
    } else {
      // Neither ancestry nor content containment — the branch has unique
      // content. Nudge with caution, not "safe to delete."
      redundant.push({ name: branch, containment: 'unverified' })
    }
  }
  return redundant
}

/**
 * Format the sweep findings into a human-readable nudge, or undefined when
 * there's nothing to say, which is the silent allow on the happy path.
 */
export function buildSweepReport(
  staleWorktrees: readonly StaleWorktree[],
  redundantBranches: readonly RedundantBranch[],
  defaultBranch: string,
): string | undefined {
  if (staleWorktrees.length === 0 && redundantBranches.length === 0) {
    return undefined
  }
  const lines: string[] = []
  lines.push(
    `branch-worktree-sweep-nudge: ${staleWorktrees.length} stale ` +
      `worktree(s), ${redundantBranches.length} redundant branch(es) ` +
      `- cleanup is your call (reminder only).`,
  )
  for (let i = 0, { length } = staleWorktrees; i < length; i += 1) {
    const wt = staleWorktrees[i]!
    const detail =
      wt.reason === 'gone' || wt.reason === 'prunable'
        ? 'directory gone/prunable'
        : wt.reason === 'merged'
          ? `branch merged into ${defaultBranch}`
          : `detached HEAD older than ${DETACHED_HEAD_MAX_AGE_DAYS} days`
    const fix =
      wt.reason === 'gone' || wt.reason === 'prunable'
        ? 'git worktree prune'
        : `git worktree remove "${wt.path}"`
    lines.push(`  ${wt.path} (${detail}) - ${fix}`)
  }
  for (let i = 0, { length } = redundantBranches; i < length; i += 1) {
    const br = redundantBranches[i]!
    if (br.containment === 'ancestry') {
      lines.push(
        `  ${br.name} (fully merged into ${defaultBranch}) - ` +
          `git branch -d ${br.name}`,
      )
    } else if (br.containment === 'content-verified') {
      lines.push(
        `  ${br.name} (content verified, squash-merge) - ` +
          `git branch -D ${br.name}`,
      )
    } else {
      lines.push(
        `  ${VERDICT_GLYPHS['warn']} ${br.name} (content NOT contained in ${defaultBranch}) - ` +
          `verify content containment before deleting`,
      )
    }
  }
  return lines.join('\n')
}

export const hook = defineHook({
  check: () => {
    try {
      // Fail-open when the host did not say where the project is: this
      // nudge never blocks, so an unknown root is a silent allow, never a
      // guess at the caller's cwd.
      const repoDir = process.env['CLAUDE_PROJECT_DIR']
      if (repoDir === undefined) {
        return undefined
      }
      const defaultBranch = resolveDefaultBranch(repoDir)
      const staleWorktrees = findStaleWorktrees(repoDir, defaultBranch)
      const redundantBranches = findRedundantBranches(repoDir, defaultBranch)
      const report = buildSweepReport(
        staleWorktrees,
        redundantBranches,
        defaultBranch,
      )
      return report === undefined ? undefined : notify(report)
    } catch (e) {
      // Hooks must never crash an agent turn — surface the error, allow.
      return notify(
        `branch-worktree-sweep-nudge: unexpected error: ` +
          `${(e as Error).message}`,
      )
    }
  },
  event: 'Stop',
  // Machine-wide: stale branches and worktrees accumulate in every checkout,
  // member or not, so the sweep reminder is not a member-only concern.
  global: true,
  type: 'nudge',
})

void runHook(hook, import.meta.url)
