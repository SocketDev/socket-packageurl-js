/**
 * @file Synthetic's own quota numbers, read from its API instead of inferred
 *   from local traffic.
 *   WHY NOT KEEP COUNTING LOCALLY. Counting requests out of OpenCode's database
 *   only sees traffic OpenCode recorded. Anything run against that seat from
 *   another tool, another machine, or a plain `curl` is invisible, so the local
 *   count is an UNDER-estimate that reads as headroom. `GET /v2/quotas` is the
 *   seat's own answer: `subscription.limit`, `subscription.requests`, and when
 *   it renews.
 *   THE CREDENTIAL IS NEVER READ FROM A FILE. It comes from the environment or
 *   the OS keychain, in that order, and its value is never logged, returned, or
 *   put in an error message. A shell export does not survive into a fresh
 *   process, so the keychain is the durable slot and the env var is the
 *   override for a one-off run.
 *   NO KEY IS NOT AN ERROR. Every failure - absent key, offline, a shape the
 *   API changed - resolves to undefined, and the caller falls back to the local
 *   count. A statusline that threw because a seat could not be reached would
 *   cost the whole line.
 */

import { readCredential } from './provider-credentials.mts'

/**
 * Synthetic's quota endpoint.
 */
export const SYNTHETIC_QUOTA_URL = 'https://api.synthetic.new/v2/quotas'

/**
 * How long to wait before giving up and using the local count.
 */
export const QUOTA_TIMEOUT_MS = 2000

export interface SyntheticQuota {
  /**
   * Requests the plan allows in the current period.
   */
  readonly limit: number
  /**
   * When the period resets, as the API reported it.
   */
  readonly renewsAt: string
  /**
   * Requests already used in the current period.
   */
  readonly requests: number
}

/**
 * Pull the numbers out of a quota payload, or undefined when it is not the
 * shape this expects.
 *
 * Synthetic owns this schema, so a field that moved must read as "no quota
 * available" rather than as a zero - a zero here would draw an empty tank on a
 * seat that is actually fine.
 */
export function parseSyntheticQuota(
  payload: unknown,
): SyntheticQuota | undefined {
  if (typeof payload !== 'object' || payload === null) {
    return undefined
  }
  const subscription = (payload as Record<string, unknown>)['subscription']
  if (typeof subscription !== 'object' || subscription === null) {
    return undefined
  }
  const record = subscription as Record<string, unknown>
  const limit = record['limit']
  const requests = record['requests']
  if (
    typeof limit !== 'number' ||
    !Number.isFinite(limit) ||
    limit <= 0 ||
    typeof requests !== 'number' ||
    !Number.isFinite(requests) ||
    requests < 0
  ) {
    return undefined
  }
  const renewsAt = record['renewsAt']
  return {
    limit,
    renewsAt: typeof renewsAt === 'string' ? renewsAt : '',
    requests,
  }
}

/**
 * Ask Synthetic what is left on the seat.
 *
 * Undefined on any failure, which the caller reads as "use the local count".
 * The key never appears in a thrown message or a log line: the only place it
 * goes is the Authorization header.
 */
export async function readSyntheticQuota(
  fetchImpl: typeof fetch = fetch,
): Promise<SyntheticQuota | undefined> {
  const key = await readCredential('syntheticApiKey')
  if (!key) {
    return undefined
  }
  try {
    const response = await fetchImpl(SYNTHETIC_QUOTA_URL, {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(QUOTA_TIMEOUT_MS),
    })
    if (!response.ok) {
      return undefined
    }
    return parseSyntheticQuota(await response.json())
  } catch {
    // Offline, timed out, or a shape that changed. All of them mean the local
    // count is what the gauge gets.
    return undefined
  }
}

/**
 * How full the seat is per the API, 0 to 1.
 */
export function remainingFromQuota(quota: SyntheticQuota): number {
  return Math.max(0, Math.min(1, 1 - quota.requests / quota.limit))
}
