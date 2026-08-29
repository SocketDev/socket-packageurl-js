/**
 * @file Does THIS operator have admin rights on the repo they are pushing to.
 *   The preferred fleet flow is a direct fast-forward onto the trunk, so an
 *   operator who owns the repo should not be asked to type an authorization
 *   phrase to do the thing they are entitled to do. A prompt that fires on
 *   every push is a prompt that gets answered reflexively, which costs the
 *   guard its meaning for the cases it exists to catch. Entitlement is PROBED,
 *   not declared. The roster tier in `repo-mode.mts` says what a repo is; it
 *   cannot say what the person at the keyboard may do, and the two disagree
 *   whenever an operator has admin on a member repo. `gh api
 *   repos/<owner>/<name>` reports the viewer's own permissions, so the answer
 *   is about this account on this repo. Cached in the shared state DB, keyed by
 *   repo AND login, because a checkout can be pushed by more than one account
 *   and an answer about one says nothing about the other. The `gh` round trip
 *   costs a few hundred milliseconds and a PreToolUse hook runs in the
 *   foreground of every push, so paying it once a day is the difference between
 *   a guard and a stall. This only ever WIDENS to a non-force push. Server-side
 *   branch protection remains the real backstop: a false yes here produces a
 *   push GitHub is still free to refuse, while a force push keeps the strict
 *   human gate because it can destroy history that protection would otherwise
 *   preserve. Fails CLOSED. No `gh`, no network, an unreadable answer, or any
 *   non-zero exit means "not established", and the operator gets the phrase
 *   prompt they would have got anyway.
 */

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  PUSH_PERMISSION_TTL_MS,
  readRepoPushPermission,
  writeRepoPushPermission,
} from '../../../../scripts/fleet/_shared/socket-state.mts'
import { normalizeRepoSlug } from './gh-target-repo.mts'

// A probe must never hang a push. `gh` is a local binary talking to a warm API;
// anything past this is a network problem, and the answer is "not established".
const PROBE_TIMEOUT_MS = 5000

/**
 * The `owner/name` slug the checkout at `cwd` tracks as origin, or ''.
 */
export function originRepoSlug(cwd: string | undefined): string {
  const origin = spawnSync('git', ['remote', 'get-url', 'origin'], {
    ...(cwd ? { cwd } : {}),
    stdio: 'pipe',
    timeout: PROBE_TIMEOUT_MS,
  })
  if (origin.error || origin.status !== 0) {
    return ''
  }
  return normalizeRepoSlug(String(origin.stdout).trim())
}

/**
 * The `gh` account this machine is authenticated as, or ''.
 */
export function ghLogin(): string {
  const result = spawnSync('gh', ['api', 'user', '--jq', '.login'], {
    stdio: 'pipe',
    timeout: PROBE_TIMEOUT_MS,
  })
  if (result.error || result.status !== 0) {
    return ''
  }
  return String(result.stdout).trim()
}

/**
 * What `gh` reports about the viewer's permissions on `repo`.
 *
 * Parsed from the two booleans that decide this, rather than the coarse
 * `permission` string, because `maintain` and `admin` are separate grants and
 * only one of them implies the ability to manage protection.
 */
export function probePushPermission(
  repo: string,
): { admin: boolean; maintain: boolean } | undefined {
  const result = spawnSync(
    'gh',
    [
      'api',
      `repos/${repo}`,
      '--jq',
      '[.permissions.admin, .permissions.maintain] | @tsv',
    ],
    { stdio: 'pipe', timeout: PROBE_TIMEOUT_MS },
  )
  if (result.error || result.status !== 0) {
    return undefined
  }
  return parsePermissionTsv(String(result.stdout))
}

/**
 * Parse the two-field TSV the probe asks for. Pure, so the parsing is testable
 * without `gh`.
 *
 * Anything that is not an explicit `true`/`false` pair is unusable: a repo the
 * token cannot see returns nulls, and reading a null as `false` would be right
 * by accident while reading it as `true` would hand out an entitlement nobody
 * granted.
 */
export function parsePermissionTsv(
  stdout: string,
): { admin: boolean; maintain: boolean } | undefined {
  const fields = stdout.trim().split('\t')
  if (fields.length !== 2) {
    return undefined
  }
  const [admin, maintain] = fields
  if (
    (admin !== 'false' && admin !== 'true') ||
    (maintain !== 'false' && maintain !== 'true')
  ) {
    return undefined
  }
  return { admin: admin === 'true', maintain: maintain === 'true' }
}

/**
 * Whether a cached answer is still inside the TTL.
 */
export function permissionIsFresh(checkedAt: number, now: number): boolean {
  return now - checkedAt < PUSH_PERMISSION_TTL_MS
}

/**
 * Whether this operator holds admin on the repo the checkout at `cwd` pushes
 * to.
 *
 * Reads the cache first, probes on a miss or an expiry, and records whatever it
 * learns. Returns false for every uncertainty.
 */
export function viewerHasPushAdmin(
  cwd: string | undefined,
  now: number = Date.now(),
): boolean {
  const repo = originRepoSlug(cwd)
  if (!repo) {
    return false
  }
  const login = ghLogin()
  if (!login) {
    return false
  }
  const cached = readRepoPushPermission(repo, login)
  if (cached && permissionIsFresh(cached.checkedAt, now)) {
    return cached.admin
  }
  const probed = probePushPermission(repo)
  if (!probed) {
    // Not cached: an offline probe should not pin a NO for a day.
    return false
  }
  writeRepoPushPermission({
    admin: probed.admin,
    checkedAt: now,
    login,
    maintain: probed.maintain,
    repo,
  })
  return probed.admin
}
