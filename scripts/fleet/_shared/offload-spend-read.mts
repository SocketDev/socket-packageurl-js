/**
 * @file The I/O half of the offload-spend module: reads each provider's usage
 *   from OpenCode's SQLite database and the providers' own surfaces. Split from
 *   `offload-spend.mts` so the pure constants, types, and tally functions there
 *   can be imported by a SQLite-free renderer (the perry-compiled statusline
 *   entry) without pulling `node:sqlite` or the credential-backed readers into
 *   it. `readOffloadSpend` stays the single orchestrator the statusline and the
 *   report both call; only its home moved.
 */

import process from 'node:process'

import {
  GAUGE_PROVIDERS,
  opencodeDbPath,
  PROVIDER_FIREWORKS,
  PROVIDER_OPENAI,
  sumProviderSpend,
} from './offload-spend.mts'
import type {
  GaugeProvider,
  ProviderSpend,
  SpendWindows,
} from './offload-spend.mts'
import { readCodexModel } from './codex-model.mts'
import { readCodexRateLimit, remainingFromRateLimit } from './codex-usage.mts'
import { readFireworksSpend } from './fireworks-usage.mts'
import { readSyntheticQuota, remainingFromQuota } from './synthetic-quota.mts'

/**
 * Every provider in {@link GAUGE_PROVIDERS} comes back, including one with no
 * rows: a gauge that disappears when a provider goes unused reads as a broken
 * statusline rather than as an idle provider.
 */
export async function readOffloadSpend(
  windows: SpendWindows,
  dbPath: string = opencodeDbPath(),
): Promise<ProviderSpend[]> {
  let totals = new Map<string, ProviderSpend>()
  try {
    // Reached through getBuiltinModule so a Node build without node:sqlite
    // degrades to empty gauges instead of failing the import and taking the
    // whole statusline with it.
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
    const db = new DatabaseSync(dbPath, { readOnly: true })
    try {
      const rows = db
        .prepare('select time_created, data from message')
        .all() as unknown as Array<{ data: string; time_created: number }>
      totals = sumProviderSpend(rows, windows)
    } finally {
      db.close()
    }
  } catch {
    // No database, no read permission, or a schema OpenCode changed. Every one
    // of those is "nothing measured", never a thrown statusline.
  }
  // The seat's own numbers, where the provider publishes them - and ONLY when
  // the caller asks. Resolving a credential means reading the OS keychain,
  // which shows an auth prompt; the statusline re-runs on every render, so
  // doing this there asks for a password over and over. The render path takes
  // the local reading, and a report or CLI run - which happens when a human
  // asked for one - opts in.
  const [authoritative, fireworksUsd] = windows.authoritative
    ? await Promise.all([
        readAuthoritativeRemaining(),
        readFireworksSpend(windows.monthFromMs, windows.nowMs),
      ])
    : [{} as Partial<Record<GaugeProvider, number>>, undefined]
  const codexModel = readCodexModel()
  // The codex seat's rate window, from the seat's OWN rollout records - the
  // server's used_percent, not a locally-invented ceiling. This read is local
  // files only, so unlike the credential-backed reads it runs on EVERY render,
  // never behind the authoritative opt-in.
  const codexRateLimit = readCodexRateLimit()
  return GAUGE_PROVIDERS.map(provider => {
    const local = totals.get(provider) ?? {
      messages: 0,
      model: '',
      provider,
      usd: 0,
      windowRequests: 0,
    }
    const remaining = authoritative[provider]
    return {
      ...local,
      // Codex leaves no row in OpenCode's database, so its model comes from the
      // place that decides it rather than from what was observed running.
      ...(provider === PROVIDER_OPENAI && codexModel
        ? { model: codexModel }
        : {}),
      ...(remaining === undefined ? {} : { authoritativeRemaining: remaining }),
      ...(provider === PROVIDER_OPENAI && codexRateLimit !== undefined
        ? {
            authoritativeRemaining: remainingFromRateLimit(codexRateLimit),
            ...(codexRateLimit.windowMinutes === undefined
              ? {}
              : { rateWindowMinutes: codexRateLimit.windowMinutes }),
          }
        : {}),
      ...(provider === PROVIDER_FIREWORKS && fireworksUsd !== undefined
        ? { authoritativeUsd: fireworksUsd }
        : {}),
    }
  })
}

/**
 * Each provider's own headroom, for the providers that publish it.
 *
 * Only Synthetic does today. Fireworks meters dollars against an expectation
 * rather than an enforced limit, and Codex publishes nothing, so both keep the
 * local reading.
 */
export async function readAuthoritativeRemaining(): Promise<
  Partial<Record<GaugeProvider, number>>
> {
  const quota = await readSyntheticQuota()
  return quota === undefined ? {} : { synthetic: remainingFromQuota(quota) }
}
