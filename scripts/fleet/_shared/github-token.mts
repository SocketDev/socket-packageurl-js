/*
 * @file One GitHub token resolver for the fleet's scripts.
 *
 *   Three sources, in order: socket-lib's own resolver
 *   (`GITHUB_TOKEN`/`GH_TOKEN`, then `git config github.token`), then
 *   `gh auth token`.
 *
 *   The `gh` step is the one that matters in practice and the reason this
 *   module exists. socket-lib does NOT shell out to `gh` anywhere; it reads
 *   env and git config only. But `gh auth login` stores its token in the OS
 *   KEYCHAIN, so on a developer machine all three of socket-lib's sources come
 *   back empty while `gh auth token` answers immediately. Any caller that
 *   stopped at socket-lib's resolver would therefore go unauthenticated on the
 *   exact machine most likely to be authenticated.
 *
 *   The cost of getting this wrong is a SILENT downgrade, not an error.
 *   GitHub answers unauthenticated requests at 60/hour instead of 5000, so a
 *   sweep over a few dozen repos succeeds for the first handful and then
 *   reports "failed to fetch releases" for the rest. That reads as a network
 *   problem. It happened: `external-tools/update.mts` read only
 *   `process.env['GITHUB_TOKEN']`, found nothing, and every planner run past
 *   the first few tools failed while `gh api rate_limit` showed 4853/5000
 *   authenticated requests still available.
 *
 *   Returns undefined when nothing is available, so a caller can still make
 *   the request unauthenticated rather than refusing to run. A caller that
 *   sweeps many URLs should SAY it is unauthenticated, so the 60/hour wall is
 *   attributable when it arrives.
 */

import { getGitHubTokenWithFallback } from '@socketsecurity/lib-stable/github/token'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

/**
 * The token `gh` holds, or undefined. Separated so a caller can tell the
 * keychain source apart from the env one when reporting.
 */
export async function ghCliToken(): Promise<string | undefined> {
  try {
    const result = await spawn('gh', ['auth', 'token'])
    return String(result.stdout).trim() || undefined
  } catch {
    // gh absent, or not logged in. Not an error: the caller degrades to an
    // unauthenticated request.
    return undefined
  }
}

// Memoized as the PROMISE, not the value, so concurrent callers share one
// resolution. A sweep calls this once per repo; without the memo each call
// spawns `gh auth token` again, which is slower than the request it is
// authenticating.
let cached: Promise<string | undefined> | undefined

/**
 * The GitHub token to authenticate with, from env, git config, or `gh`.
 * Resolved once per process.
 */
export async function resolveGitHubToken(): Promise<string | undefined> {
  cached ??= (async () => {
    const fromLib = await getGitHubTokenWithFallback()
    return fromLib || (await ghCliToken())
  })()
  return await cached
}

/**
 * Drop the memo. For tests, which need to vary the environment.
 */
export function clearGitHubTokenCache(): void {
  cached = undefined
}

/**
 * The `Authorization` header value for `token`, or undefined when there is no
 * token. Kept next to the resolver so every caller spells the scheme the same
 * way.
 */
export function githubAuthHeader(
  token: string | undefined,
): string | undefined {
  return token ? `Authorization: Bearer ${token}` : undefined
}
