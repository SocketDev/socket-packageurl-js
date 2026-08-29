/**
 * @file Keyless pricing-refresh leg for the weekly update. The per-token
 *   priced services (anthropic, fireworks) carry a freshness window anchored
 *   to a weekly refresh (pricing-data-is-current), but that refresh used to
 *   ride the keyed `/updating` umbrella — which never runs in CI, so the
 *   snapshots aged out between manual runs. This leg re-sources them without
 *   a key: fetch the service's pricingSource, narrow the page to its pricing
 *   lines, hand the text plus the committed model-id list to the odai CLI's
 *   `pricing` extraction task, validate the reply against the known ids, and
 *   let `update-model-pricing.mts` own the write and the snapshot restamp.
 *   Flat-rate plan services (synthetic) are out of scope — plan structure
 *   and model-set verification is deliberate-edit territory and stays with
 *   the updating-pricing skill.
 *   Fail-open by construction: every environment gap (opt-out, no bin, no
 *   backend, fetch failure, an extraction that reads nothing) reads as a
 *   skip note, the updater merges so absent models keep their current
 *   rates, and the leg never invents a number.
 */

import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { httpText } from '@socketsecurity/lib-stable/http-request'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  FRESHNESS_BY_SERVICE,
  FRESHNESS_DAYS,
} from '../check/pricing-data-is-current.mts'
import { loadPricing } from '../estimate-ai-cost.mts'
import {
  localAssistEnabled,
  resolveOdaiBin,
  runOdaiBatch,
} from '../_shared/odai.mts'

/**
 * Per extraction task's prompt budget. Extraction reads a narrowed page, so
 * it needs less room than the decision tasks; 60s keeps a two-service batch
 * under odai's scaled spawn backstop.
 */
export const PRICING_TASK_TIMEOUT_MS = 60_000

/**
 * Page fetches get 30s before the service reads as a skip note.
 */
export const PRICING_FETCH_TIMEOUT_MS = 30_000

/**
 * Cap on the narrowed page text handed to a small on-device model.
 */
export const PRICING_SOURCE_TEXT_LIMIT = 6000

export interface PricingRefreshConfig {
  readonly cwd: string
}

/**
 * The pricing leg's outcome, mirroring the decision leg's triple. `ok`
 * carries the receipts markdown (including the all-current no-op case);
 * `skipped` covers every environment gap; `failed` is a real
 * model/validation/write failure the caller may log before falling back.
 */
export type PricingRefreshRun =
  | { readonly outcome: 'ok'; readonly markdown: string }
  | { readonly outcome: 'skipped'; readonly reason: string }
  | { readonly outcome: 'failed'; readonly reason: string }

interface StaleService {
  readonly id: string
  readonly modelIds: string[]
  readonly pricingSource: string | undefined
  readonly snapshot: string
}

/**
 * Strip a fetched page to plain text: drop script/style bodies, then tags,
 * then collapse whitespace. The vendor pages this leg reads are server-
 * rendered pricing tables, so a naive flatten keeps every number.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Narrow page text to the lines a price read needs: any line naming a
 * committed model id, plus any line carrying pricing vocabulary for the
 * surrounding table context. Capped so a long vendor page fits a small
 * model's context; the cap note tells the model the page was clipped.
 */
export function narrowPricingText(
  text: string,
  modelIds: readonly string[],
): string {
  const needles = modelIds
    .flatMap(id => [id, id.split('/').at(-1) ?? id])
    .map(s => s.toLowerCase())
  const vocab = /price|pricing|\$|mtok|per million|per 1m|token/i
  const kept: string[] = []
  const lines = text.split(/(?<=[.!?])\s+|\n/)
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    const lower = line.toLowerCase()
    if (needles.some(n => lower.includes(n)) || vocab.test(line)) {
      kept.push(line)
    }
  }
  const joined = kept.join('\n')
  return joined.length <= PRICING_SOURCE_TEXT_LIMIT
    ? joined
    : `${joined.slice(0, PRICING_SOURCE_TEXT_LIMIT)}\n[clipped]`
}

/**
 * The per-token priced services past their freshness window. A service is
 * per-token when any committed model carries inputPerMtok; flat-rate plan
 * services (billing:'plan') are skipped by construction.
 */
export function stalePerTokenServices(
  data: ReturnType<typeof loadPricing>,
  now: Date,
): StaleService[] {
  const stale: StaleService[] = []
  const services = Object.entries(data.services ?? {})
  for (let i = 0, { length } = services; i < length; i += 1) {
    const [id, service] = services[i]!
    const models = service.models ?? {}
    const entries = Object.entries(models)
    const perToken = entries.some(
      ([, m]) =>
        typeof (m as { inputPerMtok?: unknown | undefined }).inputPerMtok ===
        'number',
    )
    if (!perToken) {
      continue
    }
    const snapshot = service.snapshot
    if (typeof snapshot !== 'string' || snapshot === '') {
      continue
    }
    const ageDays = (now.getTime() - Date.parse(snapshot)) / 86_400_000
    const window = FRESHNESS_BY_SERVICE[id] ?? FRESHNESS_DAYS
    if (ageDays > window) {
      stale.push({
        id,
        modelIds: entries.map(([modelId]) => modelId),
        pricingSource: service.pricingSource,
        snapshot,
      })
    }
  }
  return stale
}

/**
 * Validate one service's extraction: only committed ids, only finite
 * non-negative rates. The odai task already filters to the requested ids;
 * this is the fleet-side belt to its suspenders.
 */
export function validatedRates(
  value: unknown,
  modelIds: readonly string[],
): Record<string, { inputPerMtok: number; outputPerMtok: number }> {
  const known = new Set(modelIds)
  const prices = (value as { prices?: unknown | undefined } | undefined)?.prices
  const out: Record<string, { inputPerMtok: number; outputPerMtok: number }> = {
    __proto__: null,
  } as never
  if (prices === null || typeof prices !== 'object') {
    return out
  }
  const rateEntries = Object.entries(
    prices as Record<
      string,
      {
        inputPerMtok?: unknown | undefined
        outputPerMtok?: unknown | undefined
      }
    >,
  )
  for (let i = 0, { length } = rateEntries; i < length; i += 1) {
    const [id, rate] = rateEntries[i]!
    if (!known.has(id)) {
      continue
    }
    const { inputPerMtok, outputPerMtok } = rate
    if (
      typeof inputPerMtok === 'number' &&
      Number.isFinite(inputPerMtok) &&
      inputPerMtok >= 0 &&
      typeof outputPerMtok === 'number' &&
      Number.isFinite(outputPerMtok) &&
      outputPerMtok >= 0
    ) {
      out[id] = { inputPerMtok, outputPerMtok }
    }
  }
  return out
}

async function fetchPageText(url: string): Promise<string | undefined> {
  try {
    return await httpText(url, {
      headers: { 'user-agent': 'socket-fleet-weekly-update' },
      timeout: PRICING_FETCH_TIMEOUT_MS,
    })
  } catch {
    return undefined
  }
}

async function writeServicePrices(
  service: string,
  prices: Record<string, unknown>,
  cwd: string,
): Promise<boolean> {
  try {
    const result = await spawn(
      process.execPath,
      [
        path.join(cwd, 'scripts/fleet/update-model-pricing.mts'),
        '--service',
        service,
        '--prices',
        JSON.stringify(prices),
      ],
      { cwd, stdioString: true, timeout: 60_000 },
    )
    return result.code === 0
  } catch {
    return false
  }
}

export async function runPricingRefresh(
  config: PricingRefreshConfig,
): Promise<PricingRefreshRun> {
  if (!localAssistEnabled(config.cwd)) {
    return {
      outcome: 'skipped',
      reason: 'local assist not enabled (ai.localAssist)',
    }
  }
  const bin = resolveOdaiBin()
  if (bin === undefined) {
    return { outcome: 'skipped', reason: 'odai CLI not on PATH' }
  }
  let data: ReturnType<typeof loadPricing>
  try {
    data = loadPricing()
  } catch (error) {
    return { outcome: 'skipped', reason: errorMessage(error) }
  }
  const stale = stalePerTokenServices(data, new Date())
  if (stale.length === 0) {
    return {
      outcome: 'ok',
      markdown:
        '### On-device pricing refresh (odai)\n\n' +
        '- every per-token service snapshot is inside its freshness window\n',
    }
  }

  const notes: string[] = []
  const entries: Array<{
    id: string
    input: string
    task: 'pricing'
  }> = []
  const modelIdsByService = new Map<string, string[]>()
  for (const service of stale) {
    if (service.pricingSource === undefined) {
      notes.push(`- ${service.id}: no pricingSource recorded — left as-is`)
      continue
    }
    const html = await fetchPageText(service.pricingSource)
    if (html === undefined) {
      notes.push(
        `- ${service.id}: pricingSource fetch failed — left as-is ` +
          `(snapshot ${service.snapshot})`,
      )
      continue
    }
    const sourceText = narrowPricingText(htmlToText(html), service.modelIds)
    entries.push({
      id: service.id,
      input: JSON.stringify({ models: service.modelIds, sourceText }),
      task: 'pricing',
    })
    modelIdsByService.set(service.id, service.modelIds)
  }

  if (entries.length > 0) {
    const batch = await runOdaiBatch(entries, {
      bin,
      cwd: config.cwd,
      timeoutMs: PRICING_TASK_TIMEOUT_MS,
    })
    if (batch.outcome === 'failed') {
      return { outcome: 'failed', reason: batch.reason }
    }
    if (batch.outcome === 'skipped') {
      const detail = notes.length > 0 ? ` (${notes.join('; ')})` : ''
      return { outcome: 'skipped', reason: `${batch.reason}${detail}` }
    }
    for (const line of batch.lines) {
      const modelIds = modelIdsByService.get(line.id) ?? []
      if (!line.ok) {
        notes.push(
          `- ${line.id}: extraction failed (${line.error ?? 'no detail'}) — left as-is`,
        )
        continue
      }
      const rates = validatedRates(line.value, modelIds)
      const count = Object.keys(rates).length
      if (count === 0) {
        notes.push(
          `- ${line.id}: the page priced nothing on the committed list — left as-is`,
        )
        continue
      }
      const written = await writeServicePrices(line.id, rates, config.cwd)
      notes.push(
        written
          ? `- ${line.id}: refreshed ${count} model rate(s) and restamped the snapshot`
          : `- ${line.id}: update-model-pricing write failed — left as-is`,
      )
    }
  }

  return {
    outcome: 'ok',
    markdown: `### On-device pricing refresh (odai)\n\n${notes.join('\n')}\n`,
  }
}
