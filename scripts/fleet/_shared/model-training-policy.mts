/**
 * @file Training model policy — gates free-tier models that train on user data
 *   based on repo visibility. If ANY accessed repo is private or unknown,
 *   training models are blocked for the rest of the session.
 *   The access ledger tracks unique repos accessed during the balancer's
 *   lifetime. Once contaminated by a private repo, the session stays
 *   contaminated until restart.
 *   Fail-closed: unknown repos (no git root, no origin, owner not in roster)
 *   are treated as private.
 */

import { resolvePathToRepoCached } from './path-to-repo.mts'
import {
  isRepoPublic,
  refreshOwnerRoster,
  rosterIsFresh,
} from './repo-visibility.mts'

/**
 * Models that may train on submitted prompts. These are blocked when ANY
 * accessed repo is private.
 *
 * Source: OpenCode Zen docs — free models during their free period.
 */
export const MODELS_THAT_TRAIN = new Set([
  'big-pickle',
  'deepseek-v4-flash-free',
  'hy3-free',
  'laguna-s-2.1-free',
  'mimo-v2.5-free',
  'nemotron-3-ultra-free',
  'nemotron-3.5-lightning-free',
  'opencode/big-pickle',
  'opencode/deepseek-v4-flash-free',
  'opencode/hy3-free',
  'opencode/laguna-s-2.1-free',
  'opencode/mimo-v2.5-free',
  'opencode/nemotron-3-ultra-free',
  'opencode/nemotron-3.5-lightning-free',
])

/**
 * Check if a model trains on user data.
 */
export function modelTrainsOnData(modelId: string): boolean {
  const lower = modelId.toLowerCase()
  if (MODELS_THAT_TRAIN.has(lower)) {
    return true
  }
  if (lower.includes('-free') && !lower.includes('free-')) {
    return true
  }
  return false
}

interface AccessedRepo {
  owner: string
  repo: string
  gitRoot: string
  isPrivate: boolean
  firstAccessedAt: number
}

const accessedRepos = new Map<string, AccessedRepo>()

let sessionContaminated = false
let contaminationReason: string | undefined

let bypassEnabled = false

/**
 * Record that a file path was accessed. Resolves the path to its repo and
 * checks visibility. If private or unknown, contaminates the session.
 */
export async function recordFileAccess(filePath: string): Promise<void> {
  const repo = resolvePathToRepoCached(filePath)
  if (!repo) {
    contaminateSession('unknown repo (no git root or origin)', filePath)
    return
  }

  const key = `${repo.owner.toLowerCase()}/${repo.repo.toLowerCase()}`
  if (accessedRepos.has(key)) {
    return
  }

  let isPrivate = true
  try {
    if (!rosterIsFresh(repo.owner)) {
      await refreshOwnerRoster(repo.owner)
    }
    isPrivate = !isRepoPublic(repo.owner, repo.repo)
  } catch {
    isPrivate = true
  }

  accessedRepos.set(key, {
    owner: repo.owner,
    repo: repo.repo,
    gitRoot: repo.gitRoot,
    isPrivate,
    firstAccessedAt: Date.now(),
  })

  if (isPrivate) {
    contaminateSession(`private repo ${key}`, filePath)
  }
}

/**
 * Record multiple file paths at once.
 */
export async function recordFileAccesses(filePaths: string[]): Promise<void> {
  for (let i = 0, { length } = filePaths; i < length; i += 1) {
    const filePath = filePaths[i]!
    await recordFileAccess(filePath)
  }
}

/**
 * Mark the session as contaminated by private data.
 */
function contaminateSession(reason: string, triggerPath: string): void {
  if (sessionContaminated) {
    return
  }
  sessionContaminated = true
  contaminationReason = `${reason} (triggered by: ${triggerPath})`
}

/**
 * Check if training models can be used in the current session.
 * Returns false if ANY accessed repo is private or unknown.
 */
export function canUseTrainingModels(): boolean {
  if (bypassEnabled) {
    return true
  }
  return !sessionContaminated
}

/**
 * Get the reason why training models are blocked, if any.
 */
export function getTrainingBlockReason(): string | undefined {
  if (bypassEnabled) {
    return undefined
  }
  return contaminationReason
}

/**
 * Enable bypass for training model restrictions.
 * Used when user provides "Allow training-model bypass" phrase.
 */
export function enableTrainingModelBypass(): void {
  bypassEnabled = true
}

/**
 * Disable bypass (re-enable restrictions).
 */
export function disableTrainingModelBypass(): void {
  bypassEnabled = false
}

/**
 * Check if bypass is currently enabled.
 */
export function isTrainingModelBypassEnabled(): boolean {
  return bypassEnabled
}

/**
 * Get stats about accessed repos for diagnostics.
 */
export function getAccessedRepoStats(): {
  repos: Array<{
    key: string
    owner: string
    repo: string
    isPrivate: boolean
    firstAccessedAt: number
  }>
  contaminated: boolean
  contaminationReason: string | undefined
  bypassEnabled: boolean
} {
  return {
    repos: Array.from(accessedRepos.entries()).map(([key, entry]) => ({
      key,
      owner: entry.owner,
      repo: entry.repo,
      isPrivate: entry.isPrivate,
      firstAccessedAt: entry.firstAccessedAt,
    })),
    contaminated: sessionContaminated,
    contaminationReason,
    bypassEnabled,
  }
}

/**
 * Filter a failover ladder to remove training models when blocked.
 */
export function filterLadderForTrainingPolicy<
  T extends { model?: string | undefined },
>(ladder: readonly T[]): readonly T[] {
  if (canUseTrainingModels()) {
    return ladder
  }

  return ladder.filter(entry => {
    const model = entry.model ?? ''
    return !modelTrainsOnData(model)
  })
}

/**
 * Reset session state. Used in tests.
 */
export function resetTrainingPolicyState(): void {
  accessedRepos.clear()
  sessionContaminated = false
  contaminationReason = undefined
  bypassEnabled = false
}

/**
 * Extract file paths from a request body. Looks for paths in tool_result
 * content and system prompt file_contents sections.
 *
 * This is a best-effort extraction — not all file references will be caught,
 * but the fail-closed posture means we err on the side of caution.
 */
export function extractFilePathsFromRequest(body: unknown): string[] {
  const paths: string[] = []
  const seen = new Set<string>()

  function addPath(p: string): void {
    const normalized = p.trim()
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized)
      paths.push(normalized)
    }
  }

  function walk(obj: unknown): void {
    if (typeof obj === 'string') {
      // Matches a `/`-rooted path token that starts at the beginning of the
      // string, after whitespace, or after a quote character. Group 1
      // captures the whole `/path/like/this` token; group 2 captures the
      // same token without its leading slash.
      const matches = obj.matchAll(/(?:^|\s|["'`])(\/([\w\-./]+))/g)
      for (const match of matches) {
        const candidate = match[1]
        if (
          candidate &&
          candidate.length > 5 &&
          candidate.includes('/') &&
          !candidate.startsWith('/dev/') &&
          !candidate.startsWith('/tmp/') &&
          !candidate.startsWith('/var/')
        ) {
          addPath(candidate)
        }
      }
      return
    }

    if (Array.isArray(obj)) {
      for (const item of obj) {
        walk(item)
      }
      return
    }

    if (obj !== null && typeof obj === 'object') {
      const values = Object.values(obj)
      for (let i = 0, { length } = values; i < length; i += 1) {
        walk(values[i])
      }
    }
  }

  walk(body)
  return paths
}
