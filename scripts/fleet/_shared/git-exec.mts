/**
 * @file Centralized git command runner for fleet scripts. Wraps the lib-stable
 *   spawn with consistent defaults: the git binary, a 30s timeout, string
 *   stdio, and index.lock handling.
 *   A locked index is RETRIED here, not handed back for the caller to retry.
 *   More than one actor works a fleet checkout at once, so contention is the
 *   normal case, and it clears in well under a second. Leaving the retry to
 *   every call site meant no call site did it, and an ordinary concurrent
 *   `git add` surfaced as a hard failure mid-commit. The retry is safe because
 *   git that could not take the lock made no change, so a second attempt is a
 *   first attempt. Past the budget a GitLockError still throws, naming how long
 *   it waited; `withIsolatedIndex` remains the escape for a read that must not
 *   queue behind a writer at all.
 *   TODO(lib@7.0.0): this file becomes a thin re-export of the lib's own
 *   `git/exec` module once the pin moves past 6.7.0 - but that module detects a
 *   locked index and throws without retrying, so collapsing to a re-export
 *   first would DROP the retry above and restore the hard failure. Port
 *   withLockRetry, withLockRetryAsync, sleepSync, isIndexLockStderr and the
 *   lockRetryBudgetMs option upstream first.
 */

import {
  spawn,
  spawnSync,
} from '@socketsecurity/lib-stable/process/spawn/child'
import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import type { SpawnSyncReturns } from '@socketsecurity/lib-stable/process/spawn/types'

export const GIT_DEFAULT_TIMEOUT_MS = 30_000

const INDEX_LOCK_PATTERN = 'index.lock'

export class GitLockError extends Error {
  readonly args: readonly string[]
  constructor(args: readonly string[], message: string) {
    super(message)
    this.name = 'GitLockError'
    this.args = args
  }
}

export interface GitExecOptions {
  cwd?: string | undefined
  env?: NodeJS.ProcessEnv | undefined
  timeout?: number | undefined
  stdioString?: boolean | undefined
  // How long to keep retrying a command that failed on a locked index. 0 opts
  // out and restores fail-on-first-lock.
  lockRetryBudgetMs?: number | undefined
}

export interface GitSyncOptions extends GitExecOptions {
  input?: string | NodeJS.ArrayBufferView | undefined
  maxBuffer?: number | undefined
}

export type GitSyncResult = SpawnSyncReturns<string | Buffer>

export interface GitSpawnResult {
  cmd: string
  args: string[] | readonly string[]
  code: number
  signal: NodeJS.Signals | null
  stdout: string | Buffer
  stderr: string | Buffer
}

// How long a locked command keeps retrying before giving up, and the gap
// between attempts. A fleet checkout is worked by more than one actor at a
// time, so `index.lock` contention is the normal case rather than the
// exceptional one, and it clears in well under a second: the lock is held for
// the duration of one index write. Thirty seconds is far past that while still
// bounded, so a genuinely stuck lock still surfaces instead of hanging.
export const GIT_LOCK_RETRY_BUDGET_MS = 30_000
export const GIT_LOCK_RETRY_INTERVAL_MS = 250

export function isIndexLockStderr(
  stderr: string | Buffer | undefined,
): boolean {
  return stderrText(stderr).includes(INDEX_LOCK_PATTERN)
}

/**
 * Block this thread for `ms`.
 *
 * `gitSync` is synchronous by contract, so the retry gap cannot be a timer.
 * `Atomics.wait` on a zero-initialized SharedArrayBuffer never observes the
 * value change, so it sleeps the full timeout and needs no dependency.
 */
export function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

export interface DetectLockErrorOptions {
  /**
   * How long the runner already waited for the lock, so the thrown message can
   * say the retry budget was spent rather than implying no wait happened.
   */
  waitedMs?: number | undefined
}

export function detectLockError(
  args: readonly string[],
  stderr: string | Buffer | undefined,
  options?: DetectLockErrorOptions | undefined,
): void {
  const { waitedMs } = { __proto__: null, ...options } as DetectLockErrorOptions
  if (isIndexLockStderr(stderr)) {
    const waited = waitedMs
      ? ` Waited: ${waitedMs}ms for the lock to clear.`
      : ''
    throw new GitLockError(
      args,
      `The git index is locked by another process. Where: git ${args.join(' ')}. Saw: ${INDEX_LOCK_PATTERN} in stderr.${waited} Fix: let the holding git process finish, or use withIsolatedIndex to bypass the shared index lock. Never delete index.lock while a git process is running - that corrupts the index it is mid-write on.`,
    )
  }
}

export interface LockRetryOptions {
  budgetMs?: number | undefined
  intervalMs?: number | undefined
  sleep?: ((ms: number) => void) | undefined
}

/**
 * Run `attempt` until it does not fail on a locked index, or the budget runs
 * out. Returns the last result; the caller decides whether to throw.
 *
 * Retrying is safe precisely because git took the lock and stopped: a command
 * that could not open the index made no change, so a second attempt is a first
 * attempt. That is why this retries the lock case ONLY and passes every other
 * failure straight back.
 *
 * `attempt` and `sleep` are injected so the loop is unit-testable without
 * spawning git or waiting in real time.
 */
export function withLockRetry<T>(
  attempt: () => T,
  stderrOf: (result: T) => string | Buffer | undefined,
  options?: LockRetryOptions | undefined,
): { result: T; waitedMs: number } {
  const opts = { __proto__: null, ...options } as LockRetryOptions
  const budgetMs = opts.budgetMs ?? GIT_LOCK_RETRY_BUDGET_MS
  const intervalMs = opts.intervalMs ?? GIT_LOCK_RETRY_INTERVAL_MS
  const nap = opts.sleep ?? sleepSync
  let waitedMs = 0
  for (;;) {
    const result = attempt()
    if (!isIndexLockStderr(stderrOf(result)) || waitedMs >= budgetMs) {
      return { result, waitedMs }
    }
    nap(intervalMs)
    waitedMs += intervalMs
  }
}

/**
 * The async twin of `withLockRetry`, for `gitSpawn`.
 */
export async function withLockRetryAsync<T>(
  attempt: () => Promise<T>,
  stderrOf: (result: T) => string | Buffer | undefined,
  options?: LockRetryOptions | undefined,
): Promise<{ result: T; waitedMs: number }> {
  const opts = { __proto__: null, ...options } as LockRetryOptions
  const budgetMs = opts.budgetMs ?? GIT_LOCK_RETRY_BUDGET_MS
  const intervalMs = opts.intervalMs ?? GIT_LOCK_RETRY_INTERVAL_MS
  let waitedMs = 0
  for (;;) {
    // Serial by design: each attempt waits on the previous one clearing.
    // oxlint-disable-next-line no-await-in-loop -- serial retry
    const result = await attempt()
    if (!isIndexLockStderr(stderrOf(result)) || waitedMs >= budgetMs) {
      return { result, waitedMs }
    }
    // oxlint-disable-next-line no-await-in-loop -- serial retry
    await new Promise<void>(resolve => {
      setTimeout(resolve, intervalMs)
    })
    waitedMs += intervalMs
  }
}

export async function gitSpawn(
  args: readonly string[],
  options?: GitExecOptions | undefined,
): Promise<GitSpawnResult> {
  const { cwd, env, timeout, stdioString, lockRetryBudgetMs } = Object.assign(
    Object.create(null),
    options,
  )
  const { result, waitedMs } = await withLockRetryAsync(
    () =>
      spawn('git', [...args], {
        cwd,
        env,
        timeout: timeout ?? GIT_DEFAULT_TIMEOUT_MS,
        stdioString: stdioString ?? true,
      }),
    spawned => spawned.stderr,
    { budgetMs: lockRetryBudgetMs },
  )
  detectLockError(args, result.stderr, { waitedMs })
  return result
}

export function gitSync(
  args: readonly string[],
  options?: GitSyncOptions | undefined,
): GitSyncResult {
  const {
    cwd,
    env,
    timeout,
    input,
    maxBuffer,
    stdioString,
    lockRetryBudgetMs,
  } = Object.assign(Object.create(null), options)
  const { result, waitedMs } = withLockRetry(
    () =>
      spawnSync('git', [...args], {
        cwd,
        env,
        timeout: timeout ?? GIT_DEFAULT_TIMEOUT_MS,
        input,
        maxBuffer,
        stdioString: stdioString ?? true,
      }),
    spawned => spawned.stderr,
    { budgetMs: lockRetryBudgetMs },
  )
  detectLockError(args, result.stderr, { waitedMs })
  return result
}

/**
 * The stderr of a spawn result as text.
 *
 * A result can carry no stderr at all: a caller that inherits or ignores that
 * stream gets `undefined`, and so does a test double that returns only the
 * fields its subject reads. Both are ordinary, so an absent stream reads as
 * empty output rather than crashing the lock detector on the way past.
 */
export function stderrText(stderr: string | Buffer | undefined): string {
  if (typeof stderr === 'string') {
    return stderr
  }
  return stderr ? stderr.toString('utf8') : ''
}

export function withIsolatedIndex<T>(fn: () => T): T {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'git-isolated-index-'))
  const indexPath = path.join(tmpDir, 'index')
  const prevIndexFile = process.env['GIT_INDEX_FILE']
  process.env['GIT_INDEX_FILE'] = indexPath
  try {
    return fn()
  } finally {
    if (prevIndexFile === undefined) {
      delete process.env['GIT_INDEX_FILE']
    } else {
      process.env['GIT_INDEX_FILE'] = prevIndexFile
    }
    safeDeleteSync(tmpDir, { recursive: true })
  }
}
