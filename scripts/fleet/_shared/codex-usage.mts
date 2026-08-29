/**
 * @file The codex seat's real rate-limit state, read from the seat's OWN
 *   records rather than inferred locally. Every codex session rollout
 *   (`~/.codex/sessions/<y>/<m>/<d>/rollout-*.jsonl`) carries the server's
 *   `rate_limits` record on its turns: `used_percent`, the window it belongs
 *   to, and when it resets. That number is the authority the gauge estimates,
 *   so the gauge shows IT — remaining = 100 − used_percent — rather than a
 *   fraction computed from a locally-invented ceiling. The pro plan meters
 *   its usage limits as a percentage of the window, which is the only
 *   ceiling a local gauge could never weigh the same way (token weighting is
 *   the server's). A machine with no rollouts, or rollouts too old to carry
 *   the record, resolves to undefined — the honest "unmetered", never a
 *   fraction.
 */

import { closeSync, openSync, readdirSync, readSync, statSync } from 'node:fs'
import path from 'node:path'

import { CODEX_HOME } from '../paths.mts'

/**
 * One rate-limit window's server-reported state.
 */
export interface CodexRateLimit {
  readonly planType: string | undefined
  readonly resetsAtMs: number | undefined
  readonly usedPercent: number
  readonly windowMinutes: number | undefined
}

/**
 * The fraction of the window REMAINING, 0..1 — the gauge's axis.
 */
export function remainingFromRateLimit(limit: CodexRateLimit): number {
  return Math.max(0, Math.min(1, 1 - limit.usedPercent / 100))
}

export function codexSessionsDir(home: string = CODEX_HOME): string {
  return path.join(home, 'sessions')
}

/**
 * The newest rollout files, newest first, bounded so a machine with years of
 * sessions pays a handful of stats rather than a full walk. Layout is
 * <y>/<m>/<d>/rollout-*.jsonl; lexicographic order is chronological, so the
 * candidates are the tail of the sorted walk.
 */
function newestRollouts(sessionsDir: string, maxFiles: number): string[] {
  const out: string[] = []
  let years: string[] = []
  try {
    years = readdirSync(sessionsDir)
  } catch {
    return out
  }
  for (let yi = years.length - 1; yi >= 0; yi -= 1) {
    const year = years[yi]!
    if (!/^\d{4}$/.test(year)) {
      continue
    }
    let months: string[] = []
    try {
      months = readdirSync(path.join(sessionsDir, year))
    } catch {
      continue
    }
    for (let mi = months.length - 1; mi >= 0; mi -= 1) {
      let days: string[] = []
      try {
        days = readdirSync(path.join(sessionsDir, year, months[mi]!))
      } catch {
        continue
      }
      for (let di = days.length - 1; di >= 0; di -= 1) {
        let files: string[] = []
        const dayDir = path.join(sessionsDir, year, months[mi]!, days[di]!)
        try {
          files = readdirSync(dayDir)
        } catch {
          continue
        }
        for (let fi = files.length - 1; fi >= 0; fi -= 1) {
          const name = files[fi]!
          if (name.startsWith('rollout-') && name.endsWith('.jsonl')) {
            out.push(path.join(dayDir, name))
            if (out.length >= maxFiles) {
              return out
            }
          }
        }
      }
    }
  }
  return out
}

/**
 * The LAST `rate_limits` record in one rollout file: the seat's most recent
 * server-reported state in that session. Parsed by locating the record key
 * rather than line-scanning every entry — rollouts are large, and only the
 * tail carries the current state.
 */
export function lastRateLimitIn(text: string): CodexRateLimit | undefined {
  const marker = '"rate_limits":'
  const at = text.lastIndexOf(marker)
  if (at < 0) {
    return undefined
  }
  const slice = text.slice(at)
  const primary = windowRecordOf(slice, '"primary"')
  const secondary = windowRecordOf(slice, '"secondary"')
  const chosen = [primary, secondary]
    .filter((w): w is CodexRateLimit => w !== undefined)
    .toSorted(
      (a, b) =>
        (a.windowMinutes ?? Number.MAX_SAFE_INTEGER) -
        (b.windowMinutes ?? Number.MAX_SAFE_INTEGER),
    )[0]
  if (chosen === undefined) {
    return undefined
  }
  const plan = /"plan_type":"([^"]+)"/.exec(slice)
  return { ...chosen, planType: plan?.[1] }
}

/**
 * One window's record under `key` (`"primary"` or `"secondary"`), or
 * undefined when the key is absent or null. The shortest window binds first -
 * an hourly rate window runs out long before the weekly cap beside it - so
 * the caller picks the smaller window_minutes.
 */
function windowRecordOf(
  slice: string,
  key: string,
): CodexRateLimit | undefined {
  const at = slice.indexOf(`${key}:{`)
  if (at < 0) {
    return undefined
  }
  const span = slice.slice(at, at + 300)
  // `"used_percent":` then the number, integer or decimal: the seat reports a
  // whole percent on some turns and a fractional one on others, so the optional
  // `.\d+` tail is what keeps `12` and `12.5` both readable.
  const used = /"used_percent":(\d+(?:\.\d+)?)/.exec(span)
  if (!used) {
    return undefined
  }
  const window = /"window_minutes":(\d+)/.exec(span)
  const resets = /"resets_at":(\d+)/.exec(span)
  return {
    planType: undefined,
    resetsAtMs: resets ? Number(resets[1]) * 1000 : undefined,
    usedPercent: Number(used[1]),
    windowMinutes: window ? Number(window[1]) : undefined,
  }
}

/**
 * How many rollouts to inspect, newest first. The record lands on assistant
 * turns, so an idle stretch can leave the newest file without one; five
 * files covers ordinary idleness without a deep walk.
 */
export const ROLLOUT_SCAN_LIMIT = 5

/**
 * The codex seat's most recent server-reported rate-limit state, or
 * undefined when no rollout carries one. Reads the newest rollouts only, and
 * every failure resolves to undefined: a missing gauge costs a glance, a
 * thrown statusline costs the chrome.
 */
/**
 * How much of a rollout's tail to read. The rate-limit record lands on
 * assistant turns, so the seat's current state is always in the tail; reading
 * the whole file would pay megabytes per statusline render.
 */
export const TAIL_READ_BYTES = 256 * 1024

export function readCodexRateLimit(
  sessionsDir: string = codexSessionsDir(),
): CodexRateLimit | undefined {
  for (const file of newestRollouts(sessionsDir, ROLLOUT_SCAN_LIMIT)) {
    let text: string
    try {
      const stat = statSync(file)
      const start = Math.max(0, stat.size - TAIL_READ_BYTES)
      const fd = openSync(file, 'r')
      try {
        const buffer = Buffer.alloc(stat.size - start)
        readSync(fd, buffer, 0, buffer.length, start)
        text = buffer.toString('utf8')
      } finally {
        closeSync(fd)
      }
    } catch {
      continue
    }
    const found = lastRateLimitIn(text)
    if (found !== undefined) {
      return found
    }
  }
  return undefined
}
