/*
 * @file The repo-aware mode classifier: which push/land policy governs the
 *   current repo. Three modes - 'fleet-admin' (push to the default branch
 *   directly), 'fleet' (member, open PRs), 'non-fleet' (open PRs, fleet rules
 *   may not pertain). Everything else (squash opt-in, producesFleetPack,
 *   publishes, host) stays an orthogonal flag on the returned profile, so a
 *   hook asks its own one-line question instead of matching a product-type enum.
 *
 *   Two "fleet" definitions stay deliberate and separate: MODE uses the ROSTER
 *   (governance - is this a fleet member, and at what tier), while `scope:
 *   'convention'` in guard.mts uses the STRUCTURAL `.config/fleet/` test
 *   (style - has this repo opted into conventions). A foreign repo carrying
 *   `.config/fleet/` gets conventions but NOT governance. Do not unify them.
 *
 *   Fail-safe degrades to the STRICTER policy: an unresolvable repo reads
 *   'fleet'/'member', never 'fleet-admin' - a repo we cannot identify must
 *   never be handed the relaxed push policy.
 */

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import rosterJson from '../../../skills/fleet/cascading-fleet/lib/fleet-repos.json' with { type: 'json' }

import { gitOut } from './git-branch.mts'
import { isEphemeralPath } from './ephemeral-path.mts'
import { actedOnPath, isFleetRepoRoot } from './fleet-context.mts'
import {
  isFleetRepo,
  originRemoteUrl,
  slugFromRemoteUrl,
} from './fleet-repos.mts'
import { findRosterRepo, loadRosterFromRepo } from './fleet-roster.mts'

import type { ToolCallPayload } from './payload.mts'
import type { FleetPublishTarget, FleetRepoTier } from './fleet-roster.mts'

export type RepoMode = 'fleet-admin' | 'fleet' | 'non-fleet'

export type RepoHost = 'github.com' | 'ghes' | 'unknown'

export interface RepoProfile {
  readonly mode: RepoMode
  readonly tier: FleetRepoTier | undefined
  readonly optIns: readonly string[]
  readonly producesFleetPack: boolean
  readonly publishes: readonly FleetPublishTarget[]
  readonly host: RepoHost
}

// Identity for a non-fleet profile (member-tier flags are meaningless there).
function nonFleetProfile(host: RepoHost): RepoProfile {
  return {
    host,
    mode: 'non-fleet',
    optIns: [],
    producesFleetPack: false,
    publishes: ['none'],
    tier: undefined,
  }
}

function fleetProfile(config: {
  readonly host: RepoHost
  readonly optIns: readonly string[]
  readonly producesFleetPack: boolean
  readonly publishes: readonly FleetPublishTarget[]
  readonly tier: FleetRepoTier
}): RepoProfile {
  return {
    host: config.host,
    mode: config.tier === 'admin' ? 'fleet-admin' : 'fleet',
    optIns: config.optIns,
    producesFleetPack: config.producesFleetPack,
    publishes: config.publishes,
    tier: config.tier,
  }
}

// The host segment of a remote URL: `git@HOST:org/repo`, `https://HOST/org/repo`,
// `ssh://HOST/org/repo`. 'github.com' -> 'github.com', absent -> 'unknown',
// anything else -> 'ghes'.
function hostFromRemoteUrl(url: string): RepoHost {
  const m = /^(?:git@|https?:\/\/|ssh:\/\/)([^/:]+)/.exec(url)
  const host = m?.[1]
  if (!host) {
    return 'unknown'
  }
  return host === 'github.com' ? 'github.com' : 'ghes'
}

// The roster entry for `slug`, reading disk-first (live tier edits) and falling
// back to the statically-imported JSON (the bundled path, frozen at bundle
// build). Accepts the repoRoot whose disk copy `loadRosterFromRepo` reads, or
// undefined to skip straight to the static fallback.
function rosterEntryFor(
  slug: string,
  repoRoot: string,
): {
  optIns: readonly string[]
  producesFleetPack: boolean
  publishes: readonly FleetPublishTarget[]
  tier: FleetRepoTier
} {
  const disk = loadRosterFromRepo(repoRoot)
  const diskEntry = disk ? findRosterRepo(disk, slug) : undefined
  if (diskEntry) {
    return {
      optIns: diskEntry.optIns ?? [],
      producesFleetPack: diskEntry.producesFleetPack === true,
      publishes: diskEntry.publishes,
      tier: diskEntry.tier ?? 'member',
    }
  }
  const staticEntry = (
    rosterJson as {
      repos: ReadonlyArray<{
        name: string
        optIns?: readonly string[] | undefined
        producesFleetPack?: boolean | undefined
        publishes: readonly FleetPublishTarget[]
        tier?: FleetRepoTier | undefined
      }>
    }
  ).repos.find(repo => repo.name === slug)
  return {
    optIns: staticEntry?.optIns ?? [],
    producesFleetPack: staticEntry?.producesFleetPack === true,
    publishes: staticEntry?.publishes ?? ['none'],
    tier: staticEntry?.tier ?? 'member',
  }
}

const PROFILE_CACHE = new Map<string, RepoProfile>()

/**
 * Classify the repo rooted at `repoRoot` into its push/land mode + orthogonal
 * flags. Cached per normalized root (the ROOT_CACHE pattern fleet-context
 * uses), so a hook's repeated payload lookups are one resolution.
 */
export function repoProfileForRoot(repoRoot: string): RepoProfile {
  const root = normalizePath(repoRoot)
  const cached = PROFILE_CACHE.get(root)
  if (cached) {
    return cached
  }
  const profile = resolveProfile(root)
  PROFILE_CACHE.set(root, profile)
  return profile
}

function resolveProfile(root: string): RepoProfile {
  // Confident non-fleet carves: cascade repo clones and ephemeral/scratch paths
  // are never fleet-governed.
  if (
    root.includes('/.socket/_wheelhouse/repo-clones/') ||
    isEphemeralPath(root)
  ) {
    return nonFleetProfile('unknown')
  }
  const remote = originRemoteUrl(root)
  if (remote) {
    const host = hostFromRemoteUrl(remote)
    const slug = slugFromRemoteUrl(remote)
    if (slug && isFleetRepo(slug)) {
      const entry = rosterEntryFor(slug, root)
      return fleetProfile({
        host,
        optIns: entry.optIns,
        producesFleetPack: entry.producesFleetPack,
        publishes: entry.publishes,
        tier: entry.tier,
      })
    }
    return nonFleetProfile(host)
  }
  // No remote: structural fallback. A fleet marker repo root is fleet at the
  // DEFAULT member tier - a structural-only detection cannot prove admin.
  if (isFleetRepoRoot(root)) {
    return fleetProfile({
      host: 'unknown',
      optIns: [],
      producesFleetPack: false,
      publishes: ['none'],
      tier: 'member',
    })
  }
  if (gitOut(root, ['rev-parse', '--show-toplevel']) === undefined) {
    // Not a git repo at all: fail-safe to the STRICTER policy.
    return fleetProfile({
      host: 'unknown',
      optIns: [],
      producesFleetPack: false,
      publishes: ['none'],
      tier: 'member',
    })
  }
  return nonFleetProfile('unknown')
}

/**
 * Classify from a directory inside the repo - the repo root is resolved first.
 */
export function repoProfileForDir(dir: string): RepoProfile {
  const root = gitOut(dir, ['rev-parse', '--show-toplevel'])
  return repoProfileForRoot(root ?? dir)
}

/**
 * Classify the repo a tool payload acted on (file_path > cd chain > cwd), via
 * fleet-context's actedOnPath.
 */
export function repoProfileForPayload(payload: ToolCallPayload): RepoProfile {
  return repoProfileForDir(actedOnPath(payload))
}

/**
 * The mode for a directory: a thin convenience for hooks that only need the
 * push/land enum, not the full profile.
 */
export function repoModeForDir(dir: string): RepoMode {
  return repoProfileForDir(dir).mode
}

// Used by tests to reset the cache between fixtures.
export function clearRepoProfileCache(): void {
  PROFILE_CACHE.clear()
}
