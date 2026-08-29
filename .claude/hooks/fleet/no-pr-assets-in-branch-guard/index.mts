#!/usr/bin/env node
// Claude Code PreToolUse hook — no-pr-assets-in-branch-guard.
//
// Blocks a `git add` / `git commit` that would put files under a `pr-assets/`
// path segment into the PR's own branch.
//
// Screenshots and recordings made to illustrate a pull request are not the
// change under review. Committing them to the review branch bloats the diff,
// puts binaries in that branch's history for good, and reads to a reviewer as
// part of the proposal — on 2026-08-10 a reviewer asked, of a committed
// `docs/pr-assets/` directory, "Why are we adding these? and where?", which is
// the correct question. The images belonged in the PR body; the branch should
// have carried only code.
//
// The fix is a mirror branch, not deletion: keep the assets, put them on
// `<branch>-assets`, push that, and reference them from the PR body. The review
// branch then stays reviewable and the assets stay recoverable.
//
// Only NEW or MODIFIED asset paths trip this, read from `git status`, so a repo
// that legitimately tracks such a directory already is unaffected — the guard is
// about what this change adds, not about what history holds.
//
// Fires everywhere via `global: true`: the incident was in a product repo, not
// in the fleet.
//
// Bypass: `Allow pr-assets-in-branch bypass` in a recent user turn.
//
// Fails OPEN when the repo, the branch, or `git status` cannot be read: a guard
// that blocks a commit because git was unavailable is worse than a missed case.

import { currentBranch } from '../_shared/git-branch.mts'
import { extractGitCwd } from '../_shared/git-cwd.mts'
import { runGit } from '../_shared/git-runner.mts'
import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import { findInvocation } from '../_shared/shell-command.mts'
import { sortedStrings } from '../_shared/sorted-by.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

// Dispatcher pre-flight: only a git command can stage or commit anything.
export const triggers: readonly string[] = ['git']

const BYPASS_PHRASE = 'Allow pr-assets-in-branch bypass'

/**
 * A path segment reserved for PR illustration assets.
 */
const PR_ASSETS_SEGMENT_RE = /(?:^|\/)pr-assets(?:\/|$)/i

/**
 * True when `filePath` lives under a `pr-assets/` directory at any depth.
 */
export function isPrAssetPath(filePath: string): boolean {
  return PR_ASSETS_SEGMENT_RE.test(filePath.replaceAll('\\', '/'))
}

/**
 * The PR-asset paths in `porcelain` output that this change would carry: added,
 * modified, renamed, or untracked. A tracked-and-unchanged asset never appears
 * in `git status`, which is why an existing directory does not trip the guard.
 */
export function prAssetPathsInStatus(porcelain: string): string[] {
  const found = new Set<string>()
  // CRLF-safe: git on Windows ends porcelain lines with \r\n, and a stranded
  // \r would corrupt every path read out of it.
  const lines = porcelain.split(/\r?\n/)
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (line.length < 4) {
      continue
    }
    // Porcelain v1: XY then a space then the path. A rename carries
    // `old -> new`; the destination is what would land.
    const raw = line.slice(3).trim()
    const arrow = raw.lastIndexOf(' -> ')
    const candidate = arrow === -1 ? raw : raw.slice(arrow + 4)
    // Quoted paths (non-ASCII / spaces) come back with surrounding quotes.
    const filePath =
      candidate.startsWith('"') && candidate.endsWith('"')
        ? candidate.slice(1, -1)
        : candidate
    if (filePath && isPrAssetPath(filePath)) {
      found.add(filePath)
    }
  }
  return sortedStrings([...found])
}

/**
 * The mirror branch name for `branch`, the place assets belong.
 *
 * A SUFFIX, not a `<branch>/assets` path: git refs are files, so a ref cannot
 * be both a file and a directory. `jdalton/x/assets` is refused outright with
 * "directory file conflict" whenever `jdalton/x` exists — which it always does
 * here, since that is the review branch this guard fired on.
 */
export function assetsBranchName(branch: string | undefined): string {
  return `${branch && branch !== 'HEAD' ? branch : '<branch>'}-assets`
}

export const check = bashGuard((command, payload) => {
  const staging =
    findInvocation(command, { binary: 'git', subcommand: 'add' }) ||
    findInvocation(command, { binary: 'git', subcommand: 'commit' })
  if (!staging) {
    return undefined
  }
  const dir = extractGitCwd(command)
  // `--untracked-files=all`, because plain porcelain collapses an untracked
  // directory to `?? docs/` and the asset paths inside it would never be seen —
  // which is exactly the case this guard exists for: a brand-new assets dir.
  const status = runGit(['status', '--porcelain', '--untracked-files=all'], {
    cwd: dir,
  })
  // Fail open: no readable status means nothing to classify.
  if (status.status !== 0) {
    return undefined
  }
  const paths = prAssetPathsInStatus(String(status.stdout ?? ''))
  if (!paths.length) {
    return undefined
  }
  if (
    payload.transcript_path &&
    bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)
  ) {
    return undefined
  }
  const branch = currentBranch(dir)
  const assetsBranch = assetsBranchName(branch)
  const shown = paths.slice(0, 8)
  const more = paths.length - shown.length
  return block(
    [
      `no-pr-assets-in-branch-guard: this stages PR illustration asset(s) into the review branch - they bloat the diff and read as part of the proposal.`,
      `Saw: ${shown.join(', ')}${more > 0 ? `, +${more} more` : ''}`,
      `Fix: push them to \`${assetsBranch}\` from a throwaway worktree (\`git worktree add /tmp/pr-assets --detach HEAD\`) and reference them from the PR body instead of staging them here.`,
      `Bypass: \`${BYPASS_PHRASE}\` if they genuinely belong in the tree.`,
    ].join('\n'),
  )
})

export const hook = defineHook({
  bypass: ['pr-assets-in-branch'],
  bypassMode: 'manual',
  check,
  event: 'PreToolUse',
  global: true,
  matcher: ['Bash'],
  type: 'guard',
})

void runHook(hook, import.meta.url)
