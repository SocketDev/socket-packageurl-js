/*
 * @file Chrome's per-profile singleton artifacts: detection, stale healing,
 *   the "Restore pages?" bubble suppression, and the honest refusal when a
 *   live Chrome holds the profile. Extracted verbatim from
 *   browser-session.mts so npm-auth-browser.mts (which re-implemented a
 *   weaker inline version) and the acquire path share the one proven
 *   implementation. A SIGTERM'd or crashed Chrome leaves the artifacts
 *   behind, and the next launch then prints "Opening in existing browser
 *   session" and exits — a phantom holder that burned ~30 minutes of launch
 *   bounces (2026-07-31). When the lock's pid is dead, the files are trash,
 *   not a tenant.
 */

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

/**
 * Chrome's profile lock. Present while an instance holds the profile; a
 * crashed instance can leave it behind, which is why the guard reports it as
 * "possibly stale" rather than asserting a live holder.
 */
export const SINGLETON_LOCK = 'SingletonLock'

/**
 * Chrome's three per-profile singleton artifacts.
 */
export const SINGLETON_ARTIFACTS: readonly string[] = Object.freeze([
  'SingletonLock',
  'SingletonSocket',
  'SingletonCookie',
] as const)

/**
 * The pid a Chrome SingletonLock symlink encodes, or undefined when the
 * target has no readable `<host>-<pid>` shape. Pure; exported for tests.
 */
export function parseSingletonLockPid(target: string): number | undefined {
  // require-regex-comment: the trailing `-<pid>` of a `<host>-<pid>` lock target.
  const match = /-(\d+)$/.exec(target)
  if (!match) {
    return undefined
  }
  const pid = Number(match[1])
  return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined
}

/**
 * Remove stale singleton artifacts when NO live process holds the lock:
 * reads the SingletonLock symlink's `<host>-<pid>` target, probes the pid,
 * and clears all three artifacts if it is dead or unparseable. A live pid
 * leaves everything in place for {@link profileInUseRefusal} to refuse
 * honestly. Returns true when a stale set was cleared.
 */
export async function clearStaleSingletons(
  profileDir: string,
): Promise<boolean> {
  const lockPath = path.join(profileDir, SINGLETON_LOCK)
  let target: string
  try {
    target = await fs.readlink(lockPath)
  } catch {
    return false
  }
  const pid = parseSingletonLockPid(target)
  if (pid !== undefined) {
    try {
      process.kill(pid, 0)
      return false
    } catch {
      // Dead pid — the lock is stale; fall through to the cleanup.
    }
  }
  for (let i = 0, { length } = SINGLETON_ARTIFACTS; i < length; i += 1) {
    // Sequential by choice.
    // eslint-disable-next-line no-await-in-loop -- three tiny unlinks
    await safeDelete(path.join(profileDir, SINGLETON_ARTIFACTS[i]!))
  }
  return true
}

/**
 * Whether a LIVE process holds the profile's singleton lock right now (as
 * opposed to a stale lock a crash left behind). Pure over the filesystem +
 * pid probe — exported for tests and for the graft, which must skip (not
 * refuse) when the holder is alive.
 */
export async function singletonLockHeld(profileDir: string): Promise<boolean> {
  const lockPath = path.join(profileDir, SINGLETON_LOCK)
  let target: string
  try {
    target = await fs.readlink(lockPath)
  } catch {
    return false
  }
  const pid = parseSingletonLockPid(target)
  if (pid === undefined) {
    // An unparseable lock is treated as held: refusing to guess beats
    // deleting a live tenant's lock out from under it.
    return true
  }
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * The profile file whose two exit keys drive Chrome's "Restore pages?"
 * bubble, and the values that mean "last run ended normally".
 *
 * The bubble is NOT suppressible from the launch shape. A flag like
 * `--hide-crash-restore-bubble` would mean an `args` array, and the launch
 * law forbids one: every extra launch arg tried has cost a live session.
 * Chrome decides the bubble from the profile itself, so the profile is where
 * this belongs.
 */
const PROFILE_PREFERENCES = ['Default', 'Preferences']
const CLEAN_EXIT = { exit_type: 'Normal', exited_cleanly: true }

/**
 * Clear the "Restore pages?" bubble before launch by marking the profile's
 * last exit clean.
 *
 * Every run ends by closing the context rather than by Chrome's own quit
 * path, so Chrome records the previous session as crashed and offers to
 * restore it. The operator then has a modal sitting on top of the page a
 * tool is driving, which is how a tick or a sign-in gets missed. Answers
 * whether it rewrote the file. Fail-soft throughout: a profile with no
 * Preferences yet is a first launch, which has nothing to restore anyway.
 */
export async function markProfileExitedCleanly(
  profileDir: string,
): Promise<boolean> {
  const file = path.join(profileDir, ...PROFILE_PREFERENCES)
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(await fs.readFile(file, 'utf8')) as Record<
      string,
      unknown
    >
  } catch {
    return false
  }
  const profile = parsed['profile']
  // A Preferences file whose `profile` is not an object is not one this
  // should rewrite; leaving it alone beats reshaping something unrecognized.
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    return false
  }
  const current = profile as Record<string, unknown>
  if (
    current['exit_type'] === CLEAN_EXIT.exit_type &&
    current['exited_cleanly'] === CLEAN_EXIT.exited_cleanly
  ) {
    return false
  }
  current['exit_type'] = CLEAN_EXIT.exit_type
  current['exited_cleanly'] = CLEAN_EXIT.exited_cleanly
  try {
    await fs.writeFile(file, JSON.stringify(parsed))
    return true
  } catch {
    return false
  }
}

/**
 * The refusal for a profile another Chrome already holds, or undefined when
 * the profile is free to use. A second instance on one profile forces an
 * EPHEMERAL session — the sign-in appears to succeed and then evaporates —
 * so this refuses by name instead. The caller answers the lock-existence
 * question, which keeps this pure and testable.
 */
export function profileInUseRefusal(config: {
  lockHeld: boolean
  profileDir: string
}): string | undefined {
  const cfg = { __proto__: null, ...config } as typeof config
  if (!cfg.lockHeld) {
    return undefined
  }
  return [
    'What: another Chrome instance is holding the browser profile, so this run stopped before launching a second one.',
    `Where: ${path.join(cfg.profileDir, SINGLETON_LOCK)}`,
    'Saw: the profile lock present.',
    'Wanted: sole use of the profile — a second instance forces an ephemeral session whose sign-in cannot persist.',
    `Fix: quit the Chrome window using this profile, then re-run. If no window is open, the lock is stale from a crash: delete ${SINGLETON_LOCK} in that directory and re-run.`,
  ].join('\n')
}
