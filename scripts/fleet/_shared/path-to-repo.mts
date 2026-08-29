/**
 * @file Resolve a file path to its owning git repo (owner/repo from origin).
 *   Used by the training-model gate to track which repos have been accessed
 *   during a session. If ANY accessed repo is private, training models are
 *   blocked for the rest of the session.
 *   Fail-closed: if path has no .git root, no origin, or origin doesn't parse
 *   → returns undefined, caller treats as "unknown private repo".
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

export interface RepoIdentity {
  owner: string
  repo: string
  gitRoot: string
}

/**
 * Resolve a file path to its owning git repo.
 *
 * 1. Walk up from filePath to find .git directory
 * 2. Get origin remote URL
 * 3. Parse owner/repo from URL
 *
 * Returns undefined if any step fails (fail-closed).
 */
export function resolvePathToRepo(filePath: string): RepoIdentity | undefined {
  const gitRoot = findGitRoot(filePath)
  if (!gitRoot) {
    return undefined
  }

  const originUrl = getOriginRemoteUrl(gitRoot)
  if (!originUrl) {
    return undefined
  }

  const parsed = parseGitRemoteUrl(originUrl)
  if (!parsed) {
    return undefined
  }

  return {
    owner: parsed.owner,
    repo: parsed.repo,
    gitRoot,
  }
}

/**
 * Find the .git root by walking up from a path.
 */
export function findGitRoot(fromPath: string): string | undefined {
  let current = path.resolve(fromPath)

  if (!existsSync(current)) {
    current = path.dirname(current)
  }

  const root = path.parse(current).root

  while (current && current !== root) {
    const gitDir = path.join(current, '.git')
    if (existsSync(gitDir)) {
      return current
    }
    const parent = path.dirname(current)
    if (parent === current) {
      break
    }
    current = parent
  }

  return undefined
}

/**
 * Get the origin remote URL for a git repo.
 */
export function getOriginRemoteUrl(gitRoot: string): string | undefined {
  const result = spawnSync('git', ['remote', 'get-url', 'origin'], {
    cwd: gitRoot,
    encoding: 'utf8',
    timeout: 5000,
  })

  if (result.status !== 0) {
    return undefined
  }

  return result.stdout.trim() || undefined
}

/**
 * Parse owner/repo from a git remote URL.
 *
 * Supports:
 * - https://github.com/owner/repo.git
 * - https://github.com/owner/repo
 * - git@github.com:owner/repo.git
 * - git@github.com:owner/repo
 * - ssh://git@github.com/owner/repo.git.
 */
export function parseGitRemoteUrl(
  url: string,
): { owner: string; repo: string } | undefined {
  const trimmed = url.trim()

  // Matches `https://host/owner/repo` or `https://host/owner/repo.git`:
  // group 1 is the owner, group 2 is the repo name with the `.git` suffix
  // (if present) stripped.
  const httpsMatch = trimmed.match(
    /^https?:\/\/[^/]+\/([^/]+)\/([^/]+?)(?:\.git)?$/,
  )
  if (httpsMatch) {
    return { owner: httpsMatch[1]!, repo: httpsMatch[2]! }
  }

  // Matches the SCP-style SSH form `git@host:owner/repo` or
  // `git@host:owner/repo.git`: group 1 is the owner, group 2 is the repo
  // name with the `.git` suffix (if present) stripped.
  const sshColonMatch = trimmed.match(/^git@[^:]+:([^/]+)\/([^/]+?)(?:\.git)?$/)
  if (sshColonMatch) {
    return { owner: sshColonMatch[1]!, repo: sshColonMatch[2]! }
  }

  // Matches `ssh://git@host/owner/repo` or `ssh://git@host/owner/repo.git`:
  // group 1 is the owner, group 2 is the repo name with the `.git` suffix
  // (if present) stripped.
  const sshSlashMatch = trimmed.match(
    /^ssh:\/\/git@[^/]+\/([^/]+)\/([^/]+?)(?:\.git)?$/,
  )
  if (sshSlashMatch) {
    return { owner: sshSlashMatch[1]!, repo: sshSlashMatch[2]! }
  }

  return undefined
}

/**
 * Cache of resolved repos by git root. Avoids repeated git calls for paths
 * in the same repo.
 */
// A distinct `null` sentinel (not `undefined`) is load-bearing here: it
// distinguishes "resolved to nothing, cached" from "not cached yet", which
// `Map.get()` already signals with `undefined` for an absent key.
const repoCache = new Map<string, RepoIdentity | null>()

/**
 * Resolve a file path to its owning repo, with caching by git root.
 * Returns undefined for unknown/unresolvable paths.
 */
export function resolvePathToRepoCached(
  filePath: string,
): RepoIdentity | undefined {
  const gitRoot = findGitRoot(filePath)
  if (!gitRoot) {
    return undefined
  }

  const cached = repoCache.get(gitRoot)
  if (cached !== undefined) {
    return cached ?? undefined
  }

  const resolved = resolvePathToRepo(filePath)
  // oxlint-disable-next-line socket/prefer-undefined-over-null -- the cache's `null` sentinel disambiguates a cached-as-unresolved entry from an absent key, which Map.get() already reports as `undefined`
  repoCache.set(gitRoot, resolved ?? null)
  return resolved
}

/**
 * Clear the repo cache. Used in tests.
 */
export function clearRepoCache(): void {
  repoCache.clear()
}
