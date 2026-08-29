/**
 * @file DRY readers for the GitHub Actions runner-injected runtime environment.
 *   The cache-service client (../cache/twirp.mts) and the artifact client
 *   (../artifact/) both speak the v2 results.twirp API - same results base URL,
 *   same runtime bearer token - so the "read one runner-injected variable,
 *   throw loud when it is missing" shape lives here once. Each client is
 *   runtime-only: a missing variable is a loud error, never a local fallback to
 *   hide behind.
 */

import process from 'node:process'

/**
 * Read one runner-injected variable or throw a What / Where / Saw-vs-wanted /
 * Fix error. `what` names the thing that is missing, `wanted` the value the
 * runner injects, `fix` the action that gets it set. The variable name rides in
 * `Where` so a missing-variable error always greps to the env var it names.
 */
export function requireActionsEnv(
  env: Record<string, string | undefined>,
  name: string,
  what: string,
  wanted: string,
  fix: string,
): string {
  const value = env[name]
  if (!value) {
    throw new Error(
      `The ${what} is missing. Where: the ${name} environment variable. Saw: unset or empty; wanted ${wanted}. Fix: ${fix}.`,
    )
  }
  return value
}

/**
 * The v2 results base URL (ACTIONS_RESULTS_URL) the cache and artifact clients
 * post their twirp RPCs to - the results.api.v1 CacheService and
 * ArtifactService hang off the same host root.
 */
export function readActionsResultsUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  return requireActionsEnv(
    env,
    'ACTIONS_RESULTS_URL',
    'results-service URL',
    'the v2 results-service base URL the GitHub Actions runner injects into every job',
    'run this inside a GitHub Actions job - local runs have no results service to talk to',
  )
}

/**
 * The runtime auth token (ACTIONS_RUNTIME_TOKEN) both the cache and artifact
 * clients send as a bearer.
 */
export function readActionsRuntimeToken(
  env: Record<string, string | undefined> = process.env,
): string {
  return requireActionsEnv(
    env,
    'ACTIONS_RUNTIME_TOKEN',
    'runtime auth token',
    'the runtime token the GitHub Actions runner injects into every job',
    'run this inside a GitHub Actions job - the runner sets the token automatically',
  )
}
