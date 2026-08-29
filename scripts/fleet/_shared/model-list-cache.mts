/**
 * @file The last model list each provider served, kept in the shared SQLite
 *   state DB so a click does not have to ask for one. WHY THIS EXISTS: A
 *   KEYCHAIN PROMPT PER CLICK. Listing a provider's models needs its API key,
 *   and reading that key is an OS auth prompt. The statusline caret runs as a
 *   FRESH PROCESS per click, launched by the OS with a minimal environment, so
 *   neither the in-process credential memo nor a shell `export` can reach it -
 *   every single click asked for a password. Stepping to the next model does
 *   not need a live list, only an ordered one, so the click reads this and
 *   touches no credential at all. IT ALSO TAKES THE NETWORK OFF THE CLICK PATH.
 *   A fetch on a 3-second timeout sat between the click and the change. A cache
 *   read is immediate and works on a plane. EVERY FETCHER WARMS IT, AT ONE
 *   CHOKE POINT. `listProviderModels` writes here on a successful fetch, so
 *   `--list`, `--pick`, and a report run all refresh it without knowing this
 *   table exists. Nothing else needs to remember to. NO TTL, AND THAT IS
 *   DELIBERATE. Expiry would only be useful if the click could refetch, and the
 *   whole point is that it cannot. A list that has gone stale costs a cycle
 *   onto a retired model, which fails visibly at use and is fixed by the next
 *   `--list`. A prompt on every click is worse than a month-old list.
 */

import {
  readOffloadModelLists,
  writeOffloadModelLists,
} from './socket-state.mts'
import { GAUGE_PROVIDERS } from './offload-spend.mts'

import type { GaugeProvider } from './offload-spend.mts'

interface CacheEntry {
  readonly ids: readonly string[]
}

/**
 * The whole cache, or an empty record when it is absent or unreadable.
 *
 * Every failure is an empty cache rather than a throw. The caller is a click or
 * a statusline render, and the fallback - the curated catalog - is always
 * available, so there is nothing a failure here should stop.
 */
export function readModelListCache(): Map<GaugeProvider, CacheEntry> {
  const lists = readOffloadModelLists()
  const out = new Map<GaugeProvider, CacheEntry>()
  for (let i = 0, { length } = GAUGE_PROVIDERS; i < length; i += 1) {
    const provider = GAUGE_PROVIDERS[i]!
    const entry = lists[provider]
    if (entry && entry.ids.length > 0) {
      out.set(provider, { ids: entry.ids })
    }
  }
  return out
}

/**
 * The ids last seen for a provider, or undefined when none were.
 *
 * Undefined reads as "show the catalog", the same answer a failed fetch gives,
 * so a cold cache and an offline machine take one code path.
 */
export function cachedModelIds(provider: GaugeProvider): string[] | undefined {
  const entry = readModelListCache().get(provider)
  return entry ? [...entry.ids] : undefined
}

/**
 * Record what a provider served. Best-effort: a cache that cannot be written
 * costs a click the catalog rather than costing the fetch its result.
 */
export function writeCachedModelIds(
  provider: GaugeProvider,
  ids: readonly string[],
): void {
  if (ids.length === 0) {
    return
  }
  try {
    const next = { ...readOffloadModelLists(), [provider]: { ids: [...ids] } }
    writeOffloadModelLists(next)
  } catch {
    // A read-only home or a racing writer. The next fetch tries again.
  }
}
