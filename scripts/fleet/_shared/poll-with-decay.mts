/**
 * @file Bounded polling with a DECAYING interval, the shape every wait in the
 *   fleet's browser drivers should use instead of a flat sleep loop. It has
 *   three properties, each earned from a real failure mode.
 *   DECAY, because a flat interval is wrong at both ends of a long wait. A
 *   human sign-in can take fifteen minutes, and polling it every two seconds
 *   is about 450 requests at a vendor that rate-limits and bot-scores.
 *   Starting fast and backing off keeps the first seconds responsive while the
 *   tail costs almost nothing.
 *   JITTER, because fixed intervals from several runs align and arrive
 *   together. A small random spread breaks that up, so a batch of members
 *   onboarding in one sitting does not turn into a synchronized burst.
 *   A THROWN probe means "not yet", not fatal. A page mid-navigation, a
 *   context torn down between ticks, and a transient socket all read as
 *   undefined, and the loop continues. Only a budget that expires having NEVER
 *   succeeded is a failure, and the last error travels with it so the caller
 *   can say what went wrong rather than just "timed out". The sleep function
 *   is injected, so specs run instantly with no timers.
 */

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'

/**
 * How long to wait before the next probe, given how many have already run.
 * Exported so a caller can show the schedule and a spec can assert the curve
 * without running it.
 */
export function decayIntervalMs(
  attempt: number,
  config: {
    factor?: number | undefined
    initialMs: number
    maxMs: number
  },
): number {
  const cfg = { __proto__: null, ...config } as typeof config
  const factor = cfg.factor ?? 1.5
  const grown = cfg.initialMs * factor ** Math.max(0, attempt)
  return Math.min(cfg.maxMs, Math.round(grown))
}

export interface DecayPollConfig {
  // Total wall-clock ceiling. The loop never starts a probe past it.
  budgetMs: number
  factor?: number | undefined
  initialMs?: number | undefined
  // Hard backstop on probe count, independent of the clock.
  //
  // A wall-clock budget alone assumes the injected sleep actually yields. When
  // it does not — a test double that resolves immediately, a stubbed timer —
  // the loop spins as fast as the event loop allows for the whole budget. That
  // is not hypothetical: it exhausted the heap and killed a vitest worker.
  // Time and attempts bound different failure modes, so both apply.
  maxAttempts?: number | undefined
  // Fraction of the interval to spread randomly, 0 disables. Callers that
  // must stay deterministic in a spec pass 0.
  jitterRatio?: number | undefined
  maxMs?: number | undefined
  // Called once, before the first wait, so a caller can tell the operator
  // something is pending without printing per tick.
  onFirstWait?: (() => void) | undefined
  // Injected clock + sleep so specs need no timers.
  now?: (() => number) | undefined
  random?: (() => number) | undefined
  sleep: (ms: number) => Promise<void>
}

export interface DecayPollOutcome<T> {
  attempts: number
  elapsedMs: number
  lastError?: string | undefined
  timedOut: boolean
  value?: T | undefined
}

/**
 * Poll `probe` until it returns a defined value or the budget expires.
 *
 * `probe` returns undefined for "not ready" and a value for done. It may
 * throw; that is recorded and treated as not-ready, because the states these
 * drivers wait through legitimately throw in passing.
 */
export async function pollWithDecay<T>(
  probe: () => Promise<T | undefined>,
  config: DecayPollConfig,
): Promise<DecayPollOutcome<T>> {
  const opts = { __proto__: null, ...config } as DecayPollConfig
  const now = opts.now ?? (() => Date.now())
  const random = opts.random ?? (() => Math.random())
  const initialMs = opts.initialMs ?? 1000
  const maxMs = opts.maxMs ?? 15_000
  const jitterRatio = opts.jitterRatio ?? 0.2
  // Derived so a caller need not think about it: the most probes the schedule
  // could fit in the budget if every interval were the initial one, plus
  // headroom. A sleep that yields never reaches this; one that does not, does.
  const maxAttempts =
    opts.maxAttempts ??
    Math.max(8, Math.ceil(opts.budgetMs / Math.max(1, initialMs)) + 8)
  const started = now()
  const deadline = started + opts.budgetMs
  let attempts = 0
  let announced = false
  let lastError: string | undefined
  for (;;) {
    attempts += 1
    try {
      const value = await probe()
      if (value !== undefined) {
        return {
          attempts,
          elapsedMs: now() - started,
          timedOut: false,
          value,
        }
      }
    } catch (e) {
      // Not ready, and WHY is worth keeping: a budget that expires having
      // only ever thrown should report the cause, not a bare timeout.
      lastError = errorMessage(e)
    }
    if (now() >= deadline || attempts >= maxAttempts) {
      return {
        attempts,
        elapsedMs: now() - started,
        lastError,
        timedOut: true,
      }
    }
    if (!announced) {
      opts.onFirstWait?.()
      announced = true
    }
    const base = decayIntervalMs(attempts - 1, {
      factor: opts.factor,
      initialMs,
      maxMs,
    })
    const spread = jitterRatio > 0 ? base * jitterRatio * random() : 0
    // Never sleep past the deadline: a long tail interval would otherwise
    // overshoot the budget the caller asked for.
    const remaining = Math.max(0, deadline - now())
    await opts.sleep(Math.min(Math.round(base + spread), remaining))
  }
}
