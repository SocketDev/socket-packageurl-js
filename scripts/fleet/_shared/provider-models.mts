/**
 * @file The models a provider will actually serve right now, read from its own
 *   OpenAI-compatible `/models` endpoint.
 *   WHY LIVE RATHER THAN A HARDCODED LIST. A hardcoded catalog is a snapshot of
 *   the day it was written. Providers add and retire models continually, so the
 *   list goes stale in two directions at once: it offers a model that now 404s,
 *   and it hides one that would be the better pick. The picker should show what
 *   is reachable today.
 *   THE FLEET'S DEFAULT IS STILL AN OPINION. Listing what a provider serves is
 *   not the same as knowing which to use. `MODEL_CATALOG` keeps the fleet's
 *   pick and the reason for it; this only widens the choices around that pick.
 *   THE HARDCODED CATALOG IS THE FALLBACK, NOT THE SOURCE. With no key, no
 *   network, or a changed payload, the picker shows the catalog rather than an
 *   empty dropdown - an empty picker looks broken, and a stale one still works.
 *   BOTH PROVIDERS SPEAK THE SAME DIALECT. Synthetic and Fireworks each expose
 *   an OpenAI-compatible surface, so one reader covers both and only the base
 *   URL differs.
 */

import { writeCachedModelIds } from './model-list-cache.mts'
import { PROVIDER_APIS } from './provider-apis.mts'
import { readCredential } from './provider-credentials.mts'

import type { GaugeProvider } from './offload-spend.mts'

/**
 * How long to wait before falling back to the hardcoded catalog.
 */
export const MODELS_TIMEOUT_MS = 3000

// Re-exported so existing callers keep naming these from here; they live in a
// leaf module because this one authenticates.
export { PROVIDER_APIS, providerModelIsSelectable } from './provider-apis.mts'
export type { ProviderApi } from './provider-apis.mts'

/**
 * The family a model id belongs to: its leading name token.
 *
 * `deepseek-v4-flash-0731` and `deepseek-v4-pro` are the same family;
 * `kimi-k2p7-code` and `kimi-k3` are another. Split on the first digit-run
 * or dot, because a version is where a family name stops.
 */
export function modelFamily(modelId: string): string {
  const last = modelId.split(/[/:]/).pop() ?? modelId
  const parts = last.split('-')
  const family: string[] = []
  for (let i = 0, { length } = parts; i < length; i += 1) {
    const part = parts[i]!
    // A token carrying a digit is a version, and a version is where the family
    // name stops: 'deepseek-v4-flash' is the deepseek family, not 'deepseek-v'.
    if (/\d/.test(part)) {
      break
    }
    family.push(part)
  }
  return (family.length > 0 ? family.join('-') : last).toLowerCase()
}

/**
 * Sort ids so a family stays together, families in alphabetical order.
 *
 * Plain alphabetical scatters a family across the list: `deepseek-v4-flash`,
 * then four unrelated models, then `deepseek-v4-pro`. That matters because the
 * statusline caret CYCLES this list - a reader stepping one click expects the
 * next-nearest model, not an unrelated vendor.
 */
export function sortByFamily(ids: readonly string[]): string[] {
  return ids.toSorted((left, right) => {
    const leftFamily = modelFamily(left)
    const rightFamily = modelFamily(right)
    if (leftFamily !== rightFamily) {
      return leftFamily < rightFamily ? -1 : 1
    }
    return left < right ? -1 : left > right ? 1 : 0
  })
}

/**
 * Pull the model ids out of an OpenAI-compatible list response.
 *
 * Returns undefined for a shape this does not recognise, so the caller falls
 * back to the catalog rather than rendering an empty picker.
 */
export function parseModelList(payload: unknown): string[] | undefined {
  if (typeof payload !== 'object' || payload === null) {
    return undefined
  }
  const data = (payload as Record<string, unknown>)['data']
  if (!Array.isArray(data)) {
    return undefined
  }
  const ids: string[] = []
  for (const entry of data) {
    if (typeof entry !== 'object' || entry === null) {
      continue
    }
    const id = (entry as Record<string, unknown>)['id']
    if (typeof id === 'string' && id.length > 0) {
      ids.push(id)
    }
  }
  return ids.length > 0 ? sortByFamily(ids) : undefined
}

/**
 * The models a provider will serve, as ids OpenCode can address.
 *
 * Undefined on any failure, which the caller reads as "show the catalog". The
 * key never appears anywhere but the Authorization header.
 */
export async function listProviderModels(
  provider: GaugeProvider,
  fetchImpl: typeof fetch = fetch,
): Promise<string[] | undefined> {
  const api = PROVIDER_APIS[provider]
  if (!api) {
    return undefined
  }
  const key = await readCredential(api.credential)
  if (!key) {
    return undefined
  }
  try {
    const response = await fetchImpl(`${api.baseUrl}/models`, {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(MODELS_TIMEOUT_MS),
    })
    if (!response.ok) {
      return undefined
    }
    const ids = parseModelList(await response.json())
    const prefixed = ids?.map(id => `${api.opencodePrefix}${id}`)
    if (prefixed) {
      // The one choke point every fetch passes through, so `--list`, `--pick`,
      // and a report run all warm the cache without knowing it exists. The
      // statusline caret then steps that list with no credential and no
      // network - which is the whole reason the cache is here.
      writeCachedModelIds(provider, prefixed)
    }
    return prefixed
  } catch {
    // Offline, timed out, or a shape that changed. The catalog covers all three.
    return undefined
  }
}
