/**
 * @file Fireworks' own month-to-date spend, read from its billing API instead
 *   of summed out of local traffic. WHY NOT KEEP SUMMING LOCALLY. Adding up
 *   per-message costs from OpenCode's database only sees what THIS machine ran
 *   through OpenCode. Anything on the same account from CI, another machine, or
 *   a direct API call is invisible, so the local total is an under-estimate
 *   that reads as headroom. The billing summary is the account's own answer. IT
 *   NEEDS AN ACCOUNT ID AS WELL AS A KEY. The path is scoped to an account, and
 *   the id is not derivable from the key. Both come from
 *   `provider-credentials`, and a missing either means the gauge keeps the
 *   local total. FAILURE IS SILENT, LIKE EVERY GAUGE INPUT. This runs on a
 *   statusline render, so an absent credential, a timeout, or a changed payload
 *   resolves to undefined rather than throwing.
 */

import { readFireconnectAccountId } from './fireconnect-config.mts'
import { readCredential } from './provider-credentials.mts'

/**
 * Fireworks' billing summary, scoped to one account.
 */
export function billingSummaryUrl(accountId: string): string {
  return `https://api.fireworks.ai/v1/accounts/${encodeURIComponent(accountId)}/billing/summary`
}

/**
 * How long to wait before giving up and using the local total.
 */
export const USAGE_TIMEOUT_MS = 2000

/**
 * Total the line items in a billing summary, or undefined when the payload is
 * not the shape this expects.
 *
 * Fireworks owns this schema. A field that moved must read as "no figure
 * available" rather than as zero dollars, because a zero would draw a full tank
 * on an account that has actually been spending.
 */
export function sumBillingSummary(payload: unknown): number | undefined {
  if (typeof payload !== 'object' || payload === null) {
    return undefined
  }
  const lineItems = (payload as Record<string, unknown>)['lineItems']
  if (!Array.isArray(lineItems)) {
    return undefined
  }
  let total = 0
  let sawOne = false
  for (const item of lineItems) {
    if (typeof item !== 'object' || item === null) {
      continue
    }
    const cost = (item as Record<string, unknown>)['totalCost']
    // The API returns costs as strings in some responses and numbers in others,
    // so both are read rather than one being assumed.
    const value = typeof cost === 'string' ? Number(cost) : cost
    if (typeof value === 'number' && Number.isFinite(value)) {
      total += value
      sawOne = true
    }
  }
  // An empty line-item list is a real answer - an account that has spent
  // nothing this period - but a list with no READABLE cost is a shape change.
  return lineItems.length > 0 && !sawOne ? undefined : total
}

/**
 * Ask Fireworks what the account has spent since `fromMs`.
 *
 * Undefined on any failure, which the caller reads as "use the local total".
 * The key never appears anywhere but the Authorization header.
 */
export async function readFireworksSpend(
  fromMs: number,
  toMs: number,
  fetchImpl: typeof fetch = fetch,
): Promise<number | undefined> {
  const [key, ownId] = await Promise.all([
    readCredential('fireworksApiKey'),
    readCredential('fireworksAccountId'),
  ])
  // FireConnect records the account its browser login used, so a machine that
  // signed in there needs no second copy of the id.
  const accountId = ownId ?? readFireconnectAccountId()
  if (!key || !accountId) {
    return undefined
  }
  const url = new URL(billingSummaryUrl(accountId))
  url.searchParams.set('startTime', new Date(fromMs).toISOString())
  url.searchParams.set('endTime', new Date(toMs).toISOString())
  try {
    const response = await fetchImpl(url.toString(), {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(USAGE_TIMEOUT_MS),
    })
    if (!response.ok) {
      return undefined
    }
    return sumBillingSummary(await response.json())
  } catch {
    // Offline, timed out, or a shape that changed. All of them mean the local
    // total is what the gauge gets.
    return undefined
  }
}
