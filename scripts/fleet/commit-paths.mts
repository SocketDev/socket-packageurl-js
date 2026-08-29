#!/usr/bin/env node
/*
 * @file Commit EXACTLY the named paths, without touching the shared index.
 *
 *   Two failures this replaces, both hit in one session on a checkout with
 *   several live actors.
 *
 *   1. THE INDEX SWEEP. `git commit` commits the INDEX, not the paths just
 *      staged. A co-session with its own work staged has that work swept into
 *      this session's commit, under this session's message. `git commit -o
 *      <paths>` limits it, but only if the `git add` before it survived.
 *   2. THE LOST HALF. `git add … && git commit …` loses the lock in its first
 *      half and runs NEITHER, while a `push` later in the same chain still
 *      runs, shipping whatever HEAD happens to be.
 *
 *   The commit is built in an ISOLATED index (`GIT_INDEX_FILE` into a temp dir),
 *   so the shared `.git/index` is never opened and there is no lock to lose and
 *   no other actor's staged work in reach. `read-tree HEAD`, `update-index` for
 *   the named paths only, `write-tree`, `commit-tree`, then `update-ref`.
 *
 *   The shared index IS refreshed afterwards, for the committed paths only. Skip
 *   it and `git status` reports those files as staged reversals, because the
 *   index still holds the pre-commit blob while HEAD holds the new one. That
 *   refresh is the one step needing the shared lock, and it is retried with
 *   backoff; a failure there leaves the commit intact and only the status
 *   display stale.
 *
 *   Deletions are included. `update-index --add --remove` records a path whose
 *   file is gone, which a staged-deletion commit needs.
 *
 *   Usage: node scripts/fleet/commit-paths.mts -m <msg> <path>…
 *          node scripts/fleet/commit-paths.mts -F <file> <path>…
 */

import { readFileSync } from 'node:fs'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { gitSync, withIsolatedIndex } from './_shared/git-exec.mts'
import { isIndexLockFailure, nextBackoffMs } from './_shared/git-lock-retry.mts'
import { isMainModule } from './_shared/is-main-module.mts'
import { runMain } from './_shared/run-main.mts'

import type { ScriptMeta } from './_shared/run-main.mts'
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'

const logger = getDefaultLogger()

/**
 * How many times the shared-index refresh is retried before giving up. With the
 * default schedule this spans roughly ten minutes.
 */
const REFRESH_ATTEMPTS = 8

export interface CommitPathsArgs {
  message: string | undefined
  messageFile: string | undefined
  paths: string[]
}

/**
 * Parse argv. Pure.
 *
 * A path is any non-flag argument, so the caller lists them plainly and this
 * never guesses from the working tree - guessing is what sweeps in work nobody
 * named.
 */
export function parseCommitPathsArgs(argv: readonly string[]): CommitPathsArgs {
  let message
  let messageFile
  const paths: string[] = []
  for (let i = 0, { length } = argv; i < length; i += 1) {
    const arg = argv[i]!
    if (arg === '--message' || arg === '-m') {
      i += 1
      message = argv[i]
    } else if (arg === '--file' || arg === '-F') {
      i += 1
      messageFile = argv[i]
    } else if (!arg.startsWith('-')) {
      paths.push(arg)
    }
  }
  return { message, messageFile, paths }
}

/**
 * The commit message, from the flag or the named file. `-` reads stdin,
 * matching `git commit -F -`.
 */
export function resolveMessage(args: CommitPathsArgs): string | undefined {
  if (args.message) {
    return args.message
  }
  if (!args.messageFile) {
    return undefined
  }
  if (args.messageFile === '-') {
    return readFileSync(0, 'utf8')
  }
  return readFileSync(args.messageFile, 'utf8')
}

/**
 * The `commit-tree` sign flag implied by `commit.gpgsign`.
 *
 * Read from config rather than hardcoded, so a repo that does not sign is not
 * forced to, and one whose ruleset demands a verified signature gets one.
 */
export function signFlagFor(configResult: {
  status: number | null
  stdout: unknown
}): string[] {
  if (configResult.status !== 0) {
    return []
  }
  return String(configResult.stdout).trim() === 'true' ? ['-S'] : []
}

/**
 * Run one git command, returning stdout, or throw with its stderr.
 */
function git(args: readonly string[]): string {
  const result = gitSync(args, { stdioString: true })
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(' ')} failed: ${String(result.stderr).trim()}`,
    )
  }
  return String(result.stdout).trim()
}

/**
 * Refresh the shared index for `paths`, retrying while it is locked.
 *
 * Returns false when the budget runs out, which is not a failed commit: the
 * commit already landed and only `git status` is misleading until some later
 * git command refreshes the entry.
 */
export async function refreshSharedIndex(
  paths: readonly string[],
  sleep: (ms: number) => Promise<void>,
): Promise<boolean> {
  for (let attempt = 0; attempt < REFRESH_ATTEMPTS; attempt += 1) {
    // `gitSync` THROWS GitLockError on contention rather than returning a
    // non-zero status, so a status-only check never sees the case this loop
    // exists for.
    let stderr: string
    try {
      const result = gitSync(
        ['update-index', '--add', '--remove', '--', ...paths],
        { stdioString: true },
      )
      if (result.status === 0) {
        return true
      }
      stderr = String(result.stderr)
    } catch (e) {
      stderr = errorMessage(e)
    }
    if (!isIndexLockFailure(stderr)) {
      // A real error, not contention. Report it rather than retrying into it.
      logger.warn(`commit-paths: index refresh failed: ${stderr.trim()}`)
      return false
    }
    const waitMs = nextBackoffMs(attempt)
    logger.info(
      `commit-paths: shared index locked, retrying the refresh in ${waitMs}ms`,
    )
    await sleep(waitMs)
  }
  return false
}

async function main(): Promise<void> {
  const args = parseCommitPathsArgs(process.argv.slice(2))
  const message = resolveMessage(args)
  if (!message?.trim()) {
    logger.fail('commit-paths: a message is required (-m "…" or -F <file>).')
    process.exitCode = 1
    return
  }
  if (args.paths.length === 0) {
    logger.fail('commit-paths: name at least one path.')
    process.exitCode = 1
    return
  }
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'])
  const parent = git(['rev-parse', 'HEAD'])
  // Every step below runs against a private index, so the shared one is never
  // opened and no other actor's staged work is reachable.
  // `commit-tree` does NOT sign on its own. `git commit` picks up
  // `commit.gpgsign`, so a plumbing commit that skipped it produces an unsigned
  // commit that a signature rule rejects at push time, after the work is done.
  const signArgs = signFlagFor(
    gitSync(['config', '--get', 'commit.gpgsign'], {
      stdioString: true,
    }),
  )
  const commit = withIsolatedIndex(() => {
    git(['read-tree', parent])
    git(['update-index', '--add', '--remove', '--', ...args.paths])
    const tree = git(['write-tree'])
    return gitSync(
      ['commit-tree', tree, '-p', parent, ...signArgs, '-m', message],
      { stdioString: true },
    )
  })
  if (commit.status !== 0) {
    logger.fail(
      `commit-paths: commit-tree failed: ${String(commit.stderr).trim()}`,
    )
    process.exitCode = 1
    return
  }
  const sha = String(commit.stdout).trim()
  if (sha === parent) {
    logger.warn('commit-paths: nothing to commit for those paths.')
    return
  }
  git(['update-ref', `refs/heads/${branch}`, sha, parent])
  logger.success(
    `commit-paths: ${sha.slice(0, 9)} on ${branch} (${args.paths.length} path(s))`,
  )
  const refreshed = await refreshSharedIndex(
    args.paths,
    ms => new Promise<void>(resolve => setTimeout(resolve, ms)),
  )
  if (!refreshed) {
    logger.warn(
      'commit-paths: the commit landed but the shared index is still locked - `git status` will look stale until the next git command refreshes it.',
    )
  }
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'commits exactly the named paths through an isolated index, so a co-session’s staged work is never swept in and the shared lock is never contended',
  help: `Usage: node scripts/fleet/commit-paths.mts -m <msg> <path>…

  -m, --message <msg>   the commit message
  -F, --file <path>     read the message from a file, or - for stdin
  <path>…               the paths to commit, named explicitly`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
