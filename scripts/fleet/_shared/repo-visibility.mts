/**
 * @file Repo visibility lookup via the private_repo_roster table in the Socket
 *   state DB. The roster stores private repo names per owner; a repo is public
 *   if the owner is in the roster AND the repo name is NOT in privateNames.
 *   Fail-closed: if owner not in roster, roster stale, or refresh fails →
 *   assume private. Training models must never see private repo content.
 *   TTL: 4 hours. Force refresh via `force roster refresh` bypass phrase.
 */

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { openSocketState, readPrivateRepoRoster } from './socket-state.mts'

const ROSTER_TTL_MS = 4 * 60 * 60 * 1000

/**
 * Check if an owner's roster entry is fresh (within TTL).
 */
export function rosterIsFresh(owner: string): boolean {
  const roster = readPrivateRepoRoster()
  const entry = roster.owners[owner.toLowerCase()]
  if (!entry) {
    return false
  }
  return Date.now() - entry.fetchedAt < ROSTER_TTL_MS
}

/**
 * Check if a repo is KNOWN to be public. Returns true only if:
 * 1. Owner is in roster
 * 2. Roster is fresh (within TTL)
 * 3. Repo name is NOT in privateNames.
 *
 * Returns false for private repos AND unknown repos (fail-closed).
 */
export function isRepoPublic(owner: string, repo: string): boolean {
  const roster = readPrivateRepoRoster()
  const entry = roster.owners[owner.toLowerCase()]
  if (!entry) {
    return false
  }
  if (Date.now() - entry.fetchedAt > ROSTER_TTL_MS) {
    return false
  }
  const repoLower = repo.toLowerCase()
  return !entry.privateNames.some(name => name.toLowerCase() === repoLower)
}

/**
 * Check if a repo is private or unknown. Inverse of isRepoPublic but with
 * clearer semantics for gating: returns true if training models should be
 * blocked.
 */
export function isRepoPrivateOrUnknown(owner: string, repo: string): boolean {
  return !isRepoPublic(owner, repo)
}

/**
 * Refresh the roster for a single owner by fetching all their repos from
 * GitHub and storing the private ones.
 *
 * Uses `gh api` to fetch repos. For orgs, uses `/orgs/{owner}/repos`.
 * For users, uses `/users/{owner}/repos`.
 *
 * Returns true on success, false on failure (gh not authed, rate limited, etc).
 */
export async function refreshOwnerRoster(owner: string): Promise<boolean> {
  const ownerLower = owner.toLowerCase()

  const privateNames = await fetchPrivateRepoNames(owner)
  if (privateNames === undefined) {
    return false
  }

  const db = openSocketState()
  db.prepare(
    'INSERT OR REPLACE INTO private_repo_roster (owner, fetched_at, private_names_json) VALUES (?, ?, ?)',
  ).run(ownerLower, Date.now(), JSON.stringify(privateNames))

  return true
}

/**
 * Fetch private repo names for an owner via `gh api`.
 * Returns undefined on failure.
 */
async function fetchPrivateRepoNames(
  owner: string,
): Promise<string[] | undefined> {
  const endpoints = [`orgs/${owner}/repos`, `users/${owner}/repos`]

  for (let i = 0, { length } = endpoints; i < length; i += 1) {
    const endpoint = endpoints[i]!
    const result = spawnSync(
      'gh',
      ['api', '--paginate', endpoint, '--jq', '.[] | select(.private) | .name'],
      {
        encoding: 'utf8',
        timeout: 60_000,
        env: { ...process.env, GH_PAGER: '' },
      },
    )

    if (result.status === 0 && result.stdout) {
      const names = result.stdout
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
      return names
    }

    if (result.status === 0 && result.stdout === '') {
      return []
    }
  }

  return undefined
}

/**
 * Prime the roster for all fleet owners (currently just SocketDev).
 * Call during preflight to ensure roster is fresh before any balancer use.
 */
export async function setupRosterDb(): Promise<{
  success: boolean
  refreshed: string[]
  failed: string[]
}> {
  const FLEET_OWNERS = ['SocketDev']
  const refreshed: string[] = []
  const failed: string[] = []

  for (let i = 0, { length } = FLEET_OWNERS; i < length; i += 1) {
    const owner = FLEET_OWNERS[i]!
    if (rosterIsFresh(owner)) {
      continue
    }
    const ok = await refreshOwnerRoster(owner)
    if (ok) {
      refreshed.push(owner)
    } else {
      failed.push(owner)
    }
  }

  return {
    success: failed.length === 0,
    refreshed,
    failed,
  }
}

/**
 * Force-refresh the roster for an owner, ignoring TTL.
 */
export async function forceRefreshOwnerRoster(owner: string): Promise<boolean> {
  return refreshOwnerRoster(owner)
}

/**
 * Get roster stats for diagnostics.
 */
export function getRosterStats(): {
  owners: Array<{
    owner: string
    privateCount: number
    fetchedAt: number
    ageMs: number
    fresh: boolean
  }>
} {
  const roster = readPrivateRepoRoster()
  const now = Date.now()
  const owners = Object.entries(roster.owners).map(([owner, entry]) => ({
    owner,
    privateCount: entry.privateNames.length,
    fetchedAt: entry.fetchedAt,
    ageMs: now - entry.fetchedAt,
    fresh: now - entry.fetchedAt < ROSTER_TTL_MS,
  }))
  return { owners }
}
