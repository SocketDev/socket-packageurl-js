/*
 * @file The pure layer of the offload-spend system: the per-provider quota
 *   shapes, the payer roles, the model-name helpers, and the tally that turns
 *   OpenCode message rows into per-provider spend. The I/O that reads those
 *   rows from SQLite and the providers' own surfaces lives in
 *   `offload-spend-read.mts` so this module can be imported by a SQLite-free
 *   renderer (the perry-compiled statusline entry) without pulling
 *   `node:sqlite` or the credential-backed readers into it. EVERY PROVIDER HAS
 *   A DIFFERENT METER. Fireworks bills dollars. Synthetic sells a REQUEST rate.
 *
 *   - 500 per rolling 5 hours - so a dollar gauge over it would fill on the wrong
 *     axis and read full right up until the requests ran out. Codex bills a
 *     monthly seat and exposes no usage surface at all. One quota shape per
 *     provider is the whole design; a single dollar number across all three was
 *     the bug this replaced. The providers are ordered default first,
 *     supplementary after, so the eye lands on the seat a session routes to by
 *     default before the ones it routes to by choice. This file cascades to
 *     every fleet repo. WHY NOT `opencode stats`. It prints ONE total across
 *     every provider, so a Fireworks gauge and a Synthetic gauge built from it
 *     would show the same number twice. The per-provider figure only exists in
 *     OpenCode's own database, where each assistant message carries its
 *     `providerID`, its timestamp, and the `cost` that message incurred.
 */

import path from 'node:path'

import { OPENCODE_HOME } from '../paths.mts'

/**
 * The offload providers a gauge is drawn for, in display order.
 *
 * The order is FIXED rather than activity-ranked: an instrument cluster whose
 * gauges swap places as usage moves cannot be learned, so a seat holds its
 * position and only its colour moves. An idle seat dims in place. The default
 * spend seat leads because the leftmost gauge is the one seen without reading;
 * the default seat precedes the supplementary ones.
 */
export const PROVIDER_ANTHROPIC = 'anthropic' as const
export const PROVIDER_FIREWORKS = 'fireworks-ai' as const
export const PROVIDER_ODAI = 'odai' as const
export const PROVIDER_OPENAI = 'openai' as const
export const PROVIDER_SYNTHETIC = 'synthetic' as const

export const GAUGE_PROVIDERS = [
  PROVIDER_FIREWORKS,
  PROVIDER_OPENAI,
  PROVIDER_SYNTHETIC,
] as const

export type GaugeProvider = (typeof GAUGE_PROVIDERS)[number]

/**
 * The full provider ladder for the ai-balancer and model-fallback hook,
 * ranked best-first: the offload providers (company seat first), the CLI
 * shim, the on-device seat, and the Anthropic floor last. Every consumer
 * of the ladder ordering derives from this rather than hand-writing its
 * own array.
 */
export const LADDER_PROVIDERS = [
  PROVIDER_FIREWORKS,
  PROVIDER_OPENAI,
  PROVIDER_SYNTHETIC,
  PROVIDER_ODAI,
  PROVIDER_ANTHROPIC,
] as const

export type LadderProvider = (typeof LADDER_PROVIDERS)[number]

/**
 * The seat that bills by default, so a reader knows which gauge to watch.
 *
 * It renders FIRST because the leftmost gauge is the one seen without reading.
 * `test/repo/unit/default-spend-gauge.test.mts` asserts this and
 * `GAUGE_PROVIDERS[0]` agree: two independent orderings of one fact is how a
 * layout starts disagreeing with the routing it describes.
 *
 * The statusline also puts this seat's provider label beside its model name,
 * and only this seat's, so the default is identifiable when two seats happen to
 * run the same model family.
 */
export const DEFAULT_SPEND_PROVIDER: GaugeProvider = PROVIDER_FIREWORKS

/**
 * Whose subscription a provider draws on, as a ROLE rather than a name.
 *
 * This file cascades to every fleet repo, so a person's or company's name here
 * would be one operator's details shipped to everyone. What a reader needs is
 * whether a gauge spends the company's money or their own; who that is follows
 * from whose machine it runs on.
 *
 * `signed-in-account` records a fact. The Codex seat bills whichever account
 * is logged in, and `codex login status` reports only "Logged in using
 * ChatGPT" - no account, no organisation. The payer there follows the sign-in
 * and cannot be read locally, so naming one would be a guess that reads as a
 * fact, which matters when one candidate is a personal seat.
 */
export type Payer = 'company' | 'personal' | 'signed-in-account'

/**
 * Synthetic's rate window: 500 requests every 5 hours.
 *
 * This is the binding constraint on that seat, not a dollar figure. Synthetic
 * describes the plan as worth over $100/month of API credit, but nothing meters
 * those dollars - running out of REQUESTS is what stops work, so that is what
 * the gauge measures.
 */
export const SYNTHETIC_REQUEST_LIMIT = 500
export const SYNTHETIC_WINDOW_MS = 5 * 60 * 60 * 1000

/**
 * What Fireworks is expected to absorb in a month, on the company account.
 *
 * Fireworks meters real dollars, so unlike the other two this gauge has a true
 * axis; the ceiling is an expectation rather than an enforced limit. The whole
 * reason work is routed here is that a month of it costs a rounding error
 * against the Claude seat, so a gauge that stays near full is the system
 * working, and it moving is the signal.
 */
export const FIREWORKS_MONTHLY_USD = 100

/**
 * What the ChatGPT seat behind Codex costs a month at list price.
 *
 * Carried as the WORTH of routing work here, not as a bill anyone is currently
 * paying: the seat has run at a full discount, and which account it bills
 * follows whoever signed in. It never reaches the statusline - a price does not
 * move with usage, and that line lands in screen shares.
 */
export const CODEX_SEAT_MONTHLY_USD = 200

/**
 * How a provider's usage is measured. Three shapes because the three providers
 * genuinely differ, and collapsing them loses the axis that binds.
 */
export type ProviderQuota =
  | {
      readonly kind: 'requests'
      readonly limit: number
      readonly windowMs: number
    }
  | { readonly kind: 'seat'; readonly monthlyUsd: number }
  | { readonly kind: 'usd'; readonly monthlyUsd: number }

export interface ProviderMeta {
  /**
   * Where clicking the gauge goes: the page showing this seat's real usage.
   * The gauge is measured from a local database, so the dashboard is the
   * authority a reader checks it against.
   */
  readonly dashboardUrl: string
  /**
   * The gauge's label. Three characters or fewer, because four gauges share
   * one statusline and the model name beside it is the part that changes.
   */
  readonly label: string
  readonly payer: Payer
  readonly quota: ProviderQuota
}

export const PROVIDER_META: Readonly<Record<GaugeProvider, ProviderMeta>> = {
  'fireworks-ai': {
    dashboardUrl: 'https://app.fireworks.ai/account/billing?tab=usage',
    label: 'fw',
    payer: 'company',
    quota: { kind: 'usd', monthlyUsd: FIREWORKS_MONTHLY_USD },
  },
  // A ChatGPT seat reached through Codex. ONE gauge whichever account is
  // signed in: the Socket business account replaced the personal one, and
  // switching back is a re-login rather than a second seat. The pro plan
  // meters its usage limits as a percentage of a rate window, and the seat
  // reports that percentage on every turn (`rate_limits` in the session
  // rollouts), so the gauge shows the server's own figure rather than a
  // locally-computed one. `codex login status` still reports no account, so
  // the payer stays unknown.
  openai: {
    dashboardUrl: 'https://chatgpt.com/codex/cloud/settings/analytics',
    // Named for the CLI that reaches it rather than the vendor behind it: the
    // seat is only ever used through Codex, and that is what a reader
    // recognises on the line.
    label: 'codex',
    payer: 'signed-in-account',
    quota: { kind: 'seat', monthlyUsd: CODEX_SEAT_MONTHLY_USD },
  },
  synthetic: {
    dashboardUrl: 'https://synthetic.new/billing',
    label: 'syn',
    payer: 'personal',
    quota: {
      kind: 'requests',
      limit: SYNTHETIC_REQUEST_LIMIT,
      windowMs: SYNTHETIC_WINDOW_MS,
    },
  },
}

/**
 * The label each provider shows, kept as its own map so a caller that only
 * needs the name does not reach through the whole quota record.
 */
export const PROVIDER_LABELS: Readonly<Record<GaugeProvider, string>> = {
  'fireworks-ai': PROVIDER_META['fireworks-ai'].label,
  openai: PROVIDER_META['openai'].label,
  synthetic: PROVIDER_META['synthetic'].label,
}

export interface ProviderSpend {
  /**
   * How full the seat is per the PROVIDER's own API, when it has one and
   * answered. Present means the gauge shows the authority's number rather than
   * a count inferred from local traffic, which only ever sees what this machine
   * ran through OpenCode.
   */
  readonly authoritativeRemaining?: number | undefined
  /**
   * The rate window the authoritative reading belongs to, in minutes, when
   * the provider reports one (codex does). The gauge suffixes its reading
   * with it so a percentage never floats free of its window.
   */
  readonly rateWindowMinutes?: number | undefined
  /**
   * Dollars this period per the PROVIDER's own billing API, when it has one and
   * answered. Present means the gauge shows the account's real spend rather
   * than a total summed from this machine's traffic alone.
   */
  readonly authoritativeUsd?: number | undefined
  /**
   * Assistant messages attributed to this provider this month.
   */
  readonly messages: number
  /**
   * The model this provider ran most recently, short-formed for the line. Empty
   * when nothing has run on it, which is what an idle gauge shows.
   */
  readonly model: string
  readonly provider: GaugeProvider
  /**
   * Assistant messages inside the provider's own rate window.
   */
  readonly windowRequests: number
  /**
   * Dollars this month, where the provider meters dollars at all.
   */
  readonly usd: number
}

/**
 * OpenCode's local database, which holds the per-message cost attribution.
 */
export function opencodeDbPath(home: string = OPENCODE_HOME): string {
  return path.join(home, 'opencode.db')
}

export interface SpendWindows {
  /**
   * Whether to ask each provider's own API for its numbers.
   *
   * Off by default because resolving a credential reads the OS keychain, which
   * prompts. A statusline renders constantly and must never prompt; a report a
   * human asked for can.
   */
  readonly authoritative?: boolean | undefined
  /**
   * Start of the month, for the dollar total.
   */
  readonly monthFromMs: number
  readonly nowMs: number
}

/**
 * One spelling for one model, so two seats running it read as one model.
 *
 * TWO PROVIDERS SPELL THE SAME WEIGHTS TWO WAYS. Fireworks ids carry no dots,
 * so it writes `glm-5p2` where Synthetic writes `GLM-5.2`; the same pair shows
 * up as `kimi-k2p7-code` against `Kimi-K2.7-Code`. Rendered verbatim those look
 * like four models, and a reader comparing two gauges cannot tell whether the
 * seats agree.
 *
 * A DIGIT ON EACH SIDE IS WHAT MAKES THE `p` A DECIMAL POINT. That is the whole
 * guard: `fp8`, `gpt-oss-120b`, and `deepseek-v4-pro` keep their `p` because
 * the character before it is not a digit, so a version number is the only thing
 * this rewrites.
 */
export function normalizeModelName(name: string): string {
  return name.toLowerCase().replaceAll(/(\d)p(\d)/g, '$1.$2')
}

/**
 * The last segment of a model id, in one spelling: the part that identifies it.
 *
 * OpenCode names a Fireworks model `accounts/fireworks/models/kimi-k2p7-code`
 * and a Synthetic one `hf:moonshotai/Kimi-K3`. The routing prefix is the same
 * for every model on a provider, so on a statusline it is width spent saying
 * nothing. What is left runs through {@link normalizeModelName}, so the two
 * providers' spellings of one model collapse to one name.
 */
export function shortModelName(modelId: string): string {
  const segments = modelId.split(/[/:]/)
  return normalizeModelName(segments[segments.length - 1] ?? modelId)
}

/**
 * The rate window a provider counts requests over.
 */
export function windowMsFor(provider: string): number {
  const meta = PROVIDER_META[provider as GaugeProvider] as
    | ProviderMeta
    | undefined
  return meta?.quota.kind === 'requests'
    ? meta.quota.windowMs
    : SYNTHETIC_WINDOW_MS
}

/**
 * Total each provider's usage from OpenCode's message rows.
 *
 * Two counters per provider because two providers bind on different axes: the
 * month's dollars, and the requests inside that provider's own rate window.
 * Rows are read rather than trusted - OpenCode owns this schema, so a shape
 * change must degrade to a quiet zero rather than to a thrown statusline.
 */
export function sumProviderSpend(
  rows: ReadonlyArray<{ data: string; time_created: number }>,
  windows: SpendWindows,
): Map<string, ProviderSpend> {
  const totals = new Map<string, ProviderSpend>()
  for (let i = 0, { length } = rows; i < length; i += 1) {
    const row = rows[i]!
    if (
      row.time_created < windows.monthFromMs ||
      row.time_created > windows.nowMs
    ) {
      continue
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(row.data)
    } catch {
      continue
    }
    if (typeof parsed !== 'object' || parsed === null) {
      continue
    }
    const record = parsed as Record<string, unknown>
    if (record['role'] !== 'assistant') {
      continue
    }
    const provider = record['providerID']
    if (typeof provider !== 'string' || provider.length === 0) {
      continue
    }
    const inWindow = row.time_created >= windows.nowMs - windowMsFor(provider)
    const cost = record['cost']
    const modelId = record['modelID']
    const prior = totals.get(provider)
    totals.set(provider, {
      messages: (prior?.messages ?? 0) + 1,
      // Rows arrive newest-last, so the last one wins and the gauge names what
      // is running now rather than what ran first this month.
      model:
        typeof modelId === 'string' && modelId.length > 0
          ? shortModelName(modelId)
          : (prior?.model ?? ''),
      provider: provider as GaugeProvider,
      usd: (prior?.usd ?? 0) + (typeof cost === 'number' ? cost : 0),
      windowRequests: (prior?.windowRequests ?? 0) + (inWindow ? 1 : 0),
    })
  }
  return totals
}

/**
 * The quota kind a provider meters on, as a plain string for a caller that only
 * needs to branch on it.
 */
export function quotaKindOf(meta: ProviderMeta): ProviderQuota['kind'] {
  return meta.quota.kind
}

/**
 * How full a provider's tank is, from 0 to 1, or undefined when nothing meters
 * it.
 *
 * Undefined is a real answer here rather than a failure: Codex exposes no usage
 * surface, and a fraction invented for it would be the most convincing part of
 * a wrong gauge.
 */
export function remainingFractionFor(
  spend: ProviderSpend,
  meta: ProviderMeta = PROVIDER_META[spend.provider],
): number | undefined {
  if (quotaKindOf(meta) === 'usd' && spend.authoritativeUsd !== undefined) {
    const { quota } = meta
    if (quota.kind === 'usd' && quota.monthlyUsd > 0) {
      return Math.max(
        0,
        Math.min(1, 1 - spend.authoritativeUsd / quota.monthlyUsd),
      )
    }
  }
  if (spend.authoritativeRemaining !== undefined) {
    // The seat's own API answered. A local count only sees traffic OpenCode
    // recorded on THIS machine, so it under-reports and reads as headroom that
    // is not there.
    return Math.max(0, Math.min(1, spend.authoritativeRemaining))
  }
  const { quota } = meta
  if (quota.kind === 'seat') {
    // A seat HAS limits - rate caps and weekly ceilings that genuinely run out -
    // but nothing local measures them, and the bill is flat either way. So the
    // answer is "unknown", not a fraction invented from the price.
    //
    // EXCEPT when OpenCode has recorded usage for this provider. OpenCode tracks
    // which provider each message was sent to and what it cost, so the
    // OpenAI/Codex spend IS measurable from its database. When it is, the seat
    // gets a proper bar: remaining = 1 - (recorded spend / monthly quota). When
    // it is not, the seat is truly unmetered and the answer is unknown.
    if (spend.usd > 0) {
      return Math.max(0, Math.min(1, 1 - spend.usd / quota.monthlyUsd))
    }
    return undefined
  }
  let used = 0
  if (quota.kind === 'usd') {
    used = quota.monthlyUsd > 0 ? spend.usd / quota.monthlyUsd : 0
  } else {
    used = quota.limit > 0 ? spend.windowRequests / quota.limit : 0
  }
  return Math.max(0, Math.min(1, 1 - used))
}
