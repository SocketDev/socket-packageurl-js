/**
 * @file Backoff for a contended `.git/index.lock`, and the predicate that
 *   decides a lock is dead rather than busy. A shared checkout has several live
 *   actors, so a lock is normal and waiting is the correct response: git holds
 *   it for milliseconds per operation, and a loser that fails immediately turns
 *   a scheduling detail into a lost commit. What makes it costly is failing at
 *   the WRONG layer - a `git add && git commit` chain whose first half loses
 *   the lock runs neither half, and the second half of the chain can still
 *   push, shipping somebody else's work under this session's message. Backoff
 *   rather than a fixed sleep, because the two causes need different waits. A
 *   concurrent `git status` clears in well under a second; a co-session's `pnpm
 *   install` or a cascade holds it for minutes. Doubling from a short first
 *   wait serves both without polling hard. Deterministic, with no jitter.
 *   Jitter matters when many peers retry in lockstep after a shared outage;
 *   here the contenders are a handful of local processes whose waits already
 *   differ by when they started, and a reproducible schedule is worth more than
 *   spread when reading a log. A STALE lock is the other case, and it is not
 *   the same as a busy one. A crashed git leaves the file behind with nothing
 *   holding it, and every later actor then waits out its whole budget for a
 *   lock that will never clear. {@link isStaleLock} answers that only when BOTH
 *   signals agree: the file is older than the threshold AND no git process is
 *   running. Either alone is not enough, since a long cascade is old but live,
 *   and a momentary gap between two git invocations shows no process while the
 *   lock is seconds old.
 */

/**
 * The first wait. Short, because most contention is a sub-second git command
 * and a long first wait is pure latency.
 */
export const DEFAULT_BASE_DELAY_MS = 250

/**
 * The ceiling on a single wait. Three minutes, the point past which a human
 * would rather be told than kept waiting.
 */
export const DEFAULT_MAX_DELAY_MS = 180_000

/**
 * How long a lock file must sit before staleness is even considered. Above any
 * plausible single git operation, below a human's patience.
 */
export const DEFAULT_STALE_AFTER_MS = 120_000

/**
 * The wait before attempt `attempt`, counting from 0.
 *
 * Doubles each time and clamps at `maxDelayMs`, so the schedule from the
 * defaults is 250ms, 500ms, 1s, 2s ... 3m, and then 3m forever.
 */
export function nextBackoffMs(
  attempt: number,
  options?:
    | { baseDelayMs?: number | undefined; maxDelayMs?: number | undefined }
    | undefined,
): number {
  const opts = { __proto__: null, ...options } as {
    baseDelayMs?: number | undefined
    maxDelayMs?: number | undefined
  }
  const base = opts.baseDelayMs ?? DEFAULT_BASE_DELAY_MS
  const max = opts.maxDelayMs ?? DEFAULT_MAX_DELAY_MS
  if (attempt <= 0) {
    return Math.min(base, max)
  }
  // 2 ** attempt overflows to Infinity long before it matters; the clamp below
  // catches it, so no separate guard on the exponent.
  return Math.min(base * 2 ** attempt, max)
}

/**
 * Whether git's stderr reports the index lock.
 *
 * Matched on the path fragment rather than the sentence, which git has reworded
 * across versions while the filename stayed put.
 */
export function isIndexLockFailure(stderr: string): boolean {
  return stderr.includes('index.lock')
}

/**
 * Whether a lock file is dead rather than held.
 *
 * Both signals must agree. An old lock with a live git process is a long
 * operation, and a young lock with no process is the gap between two
 * invocations - treating either as stale deletes a lock somebody is about to
 * use, which corrupts the index it was protecting.
 */
export function isStaleLock(facts: {
  ageMs: number
  gitProcessRunning: boolean
  staleAfterMs?: number | undefined
}): boolean {
  const threshold = facts.staleAfterMs ?? DEFAULT_STALE_AFTER_MS
  return !facts.gitProcessRunning && facts.ageMs >= threshold
}

/**
 * The total wait a schedule reaches after `attempts` retries. For reporting a
 * budget in a message rather than making the reader do the arithmetic.
 */
export function totalBackoffMs(
  attempts: number,
  options?:
    | { baseDelayMs?: number | undefined; maxDelayMs?: number | undefined }
    | undefined,
): number {
  let total = 0
  for (let i = 0; i < attempts; i += 1) {
    total += nextBackoffMs(i, options)
  }
  return total
}
