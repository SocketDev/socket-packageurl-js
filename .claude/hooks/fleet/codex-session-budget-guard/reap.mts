/**
 * @file Reap Codex companion processes that outlived the quick-check budget.
 *   The budget guard beside this file governs a companion's PERMISSION TO START
 *   new work: past 60s its next tool call blocks. That says nothing about work
 *   already running. A companion whose Bash call launched a long shell (`sleep
 *   330 && git fetch …`) is never asked again, so the shell outlives the budget
 *   by however long it feels like — measured on one machine: 41 companion
 *   shells alive at once, 644% CPU between them, the oldest at 40 hours against
 *   a 60-second budget. The load pushed a trivial `git rev-parse` from ~5ms to
 *   595ms and timed out every test spec that spawns real git.
 *   OWNERSHIP IS THE SAFETY PROPERTY, not age. A first version reaped purely on
 *   age, reasoning that anything the reaper must not touch is seconds old. That
 *   is false and it cost three running jobs: the codex plugin exports
 *   CODEX_COMPANION_SESSION_ID into EVERY session's shells, so a legitimate
 *   background task in the PRIMARY session carries the same marker, and a test
 *   suite two hours into a run looks exactly like a two-hour runaway. Both
 *   tests now have to pass: a FOREIGN companion id (the same discriminator
 *   `isOwnSessionId` uses next door — an id that is this session's own is the
 *   plugin's exported self-id, never a companion) AND older than the grace.
 *   SIGTERM only. A companion shell mid-write gets the chance to unwind; this
 *   never escalates to SIGKILL, since a process that ignores a term is a
 *   different problem and not one a hook should force.
 */

import process from 'node:process'

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

/**
 * How long past the budget a companion process may live before it is reaped.
 * Deliberately far above `BUDGET_MS`: the budget is a policy about starting
 * work, and this is a backstop against a process nobody will ask about again.
 * A companion doing something slow but legitimate finishes well inside it.
 */
export const REAP_GRACE_SECONDS = 15 * 60

/**
 * The env marker every companion shell carries in its command line.
 */
export const COMPANION_ENV_MARKER = 'CODEX_COMPANION_SESSION_ID'

/**
 * Seconds encoded by one `ps -o etime` field, or undefined when the shape is
 * not one ps produces. The three forms are `MM:SS`, `HH:MM:SS`, and
 * `D-HH:MM:SS` — the day-prefixed one is why a naive `split(':')` undercounts a
 * 40-hour process as 40 minutes, which would have exempted every process this
 * exists to catch.
 */
export function parseEtimeSeconds(etime: string): number | undefined {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(etime.trim())
  if (!match) {
    return undefined
  }
  const [, days, hours, minutes, seconds] = match
  return (
    Number(days ?? 0) * 86_400 +
    Number(hours ?? 0) * 3600 +
    Number(minutes) * 60 +
    Number(seconds)
  )
}

/**
 * One candidate process, as parsed from a `ps` line.
 */
export interface CompanionProcess {
  readonly ageSeconds: number
  readonly pid: number
}

/**
 * The companion session id a `ps` line carries, or undefined when it has none.
 */
export function companionIdInLine(line: string): string | undefined {
  // The marker, `=` or `='`, then the id up to the closing quote or whitespace.
  const match = new RegExp(`${COMPANION_ENV_MARKER}='?([A-Za-z0-9_-]+)`).exec(
    line,
  )
  return match?.[1]
}

/**
 * Companion processes that are BOTH foreign and older than `graceSeconds`,
 * parsed from the output of `ps -Ao pid,etime,command`.
 *
 * `ownId` is this session's own companion id, and every process carrying it is
 * skipped no matter how old. That test is what makes the reaper safe: the codex
 * plugin exports the marker into every session's shells, so this session's own
 * two-hour test run is indistinguishable from a two-hour runaway by age alone —
 * a mistake that killed three running jobs before this argument existed.
 */
export function staleCompanions(
  psOutput: string,
  graceSeconds: number,
  selfPid: number,
  ownId: string | undefined,
): CompanionProcess[] {
  const out: CompanionProcess[] = []
  const lines = psOutput.split(/\r?\n/)
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (!line.includes(COMPANION_ENV_MARKER)) {
      continue
    }
    // pid (group 1), then etime column (group 2), then the rest.
    const match = /^\s*(\d+)\s+(\S+)\s/.exec(line)
    if (!match) {
      continue
    }
    const id = companionIdInLine(line)
    // Our own session's work, whatever its age. Also skipped when the id cannot
    // be read: an unattributable process is never one to signal.
    if (id === undefined || (ownId !== undefined && id === ownId)) {
      continue
    }
    const pid = Number(match[1])
    const ageSeconds = parseEtimeSeconds(match[2]!)
    if (ageSeconds === undefined || pid === selfPid) {
      continue
    }
    if (ageSeconds > graceSeconds) {
      out.push({ ageSeconds, pid })
    }
  }
  return out
}

/**
 * Signal every FOREIGN companion process past the grace period; returns how
 * many were signalled. Fail-open throughout, matching the guard beside it: a
 * reaper that throws would take down a tool call it was never asked to judge.
 *
 * With no own-id resolvable the sweep does nothing rather than falling back to
 * age alone. A reaper that cannot tell its own session's work apart is the
 * version that killed three running jobs, so the safe default is to skip.
 */
export function reapStaleCompanions(
  graceSeconds: number = REAP_GRACE_SECONDS,
  ownId: string | undefined = process.env[COMPANION_ENV_MARKER],
): number {
  if (!ownId) {
    return 0
  }
  let listing: string
  try {
    const result = spawnSync('ps', ['-Ao', 'pid,etime,command'], {
      stdioString: true,
    })
    listing = String(result.stdout ?? '')
  } catch {
    return 0
  }
  let reaped = 0
  for (const { pid } of staleCompanions(
    listing,
    graceSeconds,
    process.pid,
    ownId,
  )) {
    try {
      process.kill(pid, 'SIGTERM')
      reaped += 1
    } catch {
      // Already gone, or not ours to signal — either way, nothing to do.
    }
  }
  return reaped
}
