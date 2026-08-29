/**
 * @file The PURE statusline renderer: turns already-resolved spend data into
 *   the one-line gauge cluster. Split from `spend-statusline.mts` so a
 *   SQLite-free, scan-free binary (the perry-compiled renderer entry) can
 *   render without importing the measurement I/O. This module does NO file
 *   reads: the caller pre-resolves `spend.model` to the currently-selected
 *   model id for selectable providers (the entry reads
 *   the offload_model_selection table) and passes the availability table
 *   explicitly (the entry reads `provider-availability.json`). `gaugeModelName`
 *   and `formatOffloadGauge` therefore take data, not providers-to-read, which
 *   is the pure/renderer half of the producer/renderer split.
 */

import process from 'node:process'

import {
  normalizeModelName,
  PROVIDER_META,
  remainingFractionFor,
  shortModelName,
} from './offload-spend.mts'
import { PROVIDER_ANTHROPIC } from './offload-spend.mts'
import type { ProviderSpend } from './offload-spend.mts'
import { gaugeColor, paintGaugeBar, paintSolid } from './gauge-ramp.mts'
import type { Rgb } from './gauge-ramp.mts'
import {
  METER_WIDTH,
  meterFraction,
  meterGlyphFor,
  renderSpendMeter,
  tierFor,
} from './claude-usage.mts'
import type { BudgetConfig } from './claude-usage.mts'
import { osc8Href, osc8Link } from './spend-report-path.mts'
import { nextModelUrl } from './terminal-link.mts'
// From the leaf, not model-targets.mts: that module spawns, and this one is
// compiled ahead of time into the statusline binary.
import { CLAUDE_TARGET } from './model-target-ids.mts'
import type { ModelTargetId } from './model-target-ids.mts'
import { pulsePhaseFor, servingStateFor } from './provider-availability.mts'
import type { AvailabilityTable } from './provider-availability.mts'
import { providerModelIsSelectable } from './provider-apis.mts'

/**
 * The step-to-the-next-model affordance beside a model name. `⌘⌄` on macOS
 * (iTerm opens OSC 8 links with a Cmd-click), `⌄` elsewhere. U+2304 + U+2318
 * are plain text-presentation glyphs, so the caret stays coloured and adds one
 * cell on macOS only.
 */
export const NEXT_MODEL_CARET = process.platform === 'darwin' ? ' ⌘⌄' : ' ⌄'

/**
 * The caret for one seat, linked to the URL that steps it.
 */
export function nextModelCaret(target: ModelTargetId): string {
  return osc8Href(nextModelUrl(target), NEXT_MODEL_CARET)
}

/**
 * How full the Claude tank is against the tier its spend sits in.
 */
export function remainingForBudget(
  spentUsd: number,
  budget: BudgetConfig,
): number {
  const tier = tierFor(spentUsd, budget)
  const against =
    tier === 'target' ? budget.target.monthly : budget.stretch.monthly
  return 1 - meterFraction(spentUsd, against)
}

/**
 * How wide every gauge on the line is, in cells. Derived from the Claude meter
 * so the four tanks read as one instrument cluster.
 */
export const GAUGE_WIDTH = METER_WIDTH

/**
 * The suffix a rate-windowed reading carries: `/hr` under 2h, `/<n>h` inside a
 * day, `/wk` for 7 days, `/<n>d` otherwise.
 */
export function rateWindowLabel(minutes: number): string {
  if (minutes < 120) {
    return '/hr'
  }
  if (minutes === 10_080) {
    return '/wk'
  }
  if (minutes < 1440) {
    return `/${Math.round(minutes / 60)}h`
  }
  return `/${Math.round(minutes / 1440)}d`
}

/**
 * A dim grey for gauges that have drawn no usage this period.
 */
const INACTIVE_RGB: Rgb = { b: 90, g: 90, r: 90 }

/**
 * Whether a provider has drawn any usage this period OR reports a live reading.
 */
export function isProviderActive(spend: ProviderSpend): boolean {
  return (
    spend.authoritativeRemaining !== undefined ||
    spend.usd > 0 ||
    spend.messages > 0 ||
    spend.windowRequests > 0
  )
}

/**
 * Whether the Claude seat is parked: the session routes around Anthropic, so
 * nothing bills this seat. Reads env vars only (no file I/O).
 */
export function claudeSeatIsParked(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const primaryProvider = env['AI_BALANCER_PRIMARY_PROVIDER']
  const baseUrl = env['ANTHROPIC_BASE_URL']
  return (
    (primaryProvider !== undefined && primaryProvider !== PROVIDER_ANTHROPIC) ||
    (baseUrl !== undefined &&
      baseUrl.includes('anthropic.com') === false &&
      baseUrl.includes('localhost') === false &&
      baseUrl.includes('127.0.0.1') === false)
  )
}

/**
 * The model name a gauge shows. The caller pre-resolves `spend.model` to the
 * currently-selected model id for selectable providers; a non-selectable seat
 * carries the model its config names. shortModelName vs normalizeModelName
 * mirrors the original: selectable seats show the short form, the openai seat
 * shows the normalized codex model.
 */
export function gaugeModelName(spend: ProviderSpend): string {
  const name = providerModelIsSelectable(spend.provider)
    ? shortModelName(spend.model)
    : normalizeModelName(spend.model)
  return name || PROVIDER_META[spend.provider].label
}

/**
 * The model names more than one gauge on this line would show, so a provider
 * label is prefixed only for a colliding name.
 */
export function collidingGaugeNames(
  spends: readonly ProviderSpend[],
): Set<string> {
  const seen = new Set<string>()
  const colliding = new Set<string>()
  for (let i = 0, { length } = spends; i < length; i += 1) {
    const name = gaugeModelName(spends[i]!)
    if (seen.has(name)) {
      colliding.add(name)
    } else {
      seen.add(name)
    }
  }
  return colliding
}

/**
 * Options for one offload gauge. `availabilityTable` is optional and defaults
 * to empty (all seats render the unknown-serving pulse): this module does no
 * file reads, so a caller that has the probe record passes it, and a caller
 * that only tests the bar/colour does not.
 */
export interface OffloadGaugeOptions {
  readonly availabilityTable?: AvailabilityTable | undefined
  readonly color?: boolean | undefined
  readonly index?: number | undefined
  readonly inactive?: boolean | undefined
  readonly labelProvider?: boolean | undefined
  readonly total?: number | undefined
  readonly nowMs?: number | undefined
}

/**
 * A provider's gauge: a bar, its reading, and the seat being billed, all in the
 * one solid colour that gauge's position earns.
 */
export function formatOffloadGauge(
  spend: ProviderSpend,
  options?: OffloadGaugeOptions | undefined,
): string {
  const opts = { __proto__: null, ...options } as OffloadGaugeOptions
  const color = opts.color === true
  const meta = PROVIDER_META[spend.provider]
  const modelName = gaugeModelName(spend)
  const labeled = opts.labelProvider === true
  const remaining = remainingFractionFor(spend)
  const rgb =
    opts.inactive === true
      ? INACTIVE_RGB
      : gaugeColor({
          index: opts.index ?? 0,
          remaining,
          total: opts.total ?? 1,
        })
  const nowMs = opts.nowMs ?? Date.now()
  const serving = servingStateFor(
    spend.provider,
    opts.availabilityTable ?? {},
    nowMs,
  )
  const displayRgb = serving === 'down' ? INACTIVE_RGB : rgb
  const meter = paintGaugeBar({
    color,
    name: labeled ? `${meta.label} ${modelName}` : modelName,
    pulsePhase: serving === 'unknown' ? pulsePhaseFor(nowMs) : undefined,
    remaining: serving === 'up' ? remaining : undefined,
    rgb: displayRgb,
    width: GAUGE_WIDTH,
  })
  const suffix =
    spend.rateWindowMinutes === undefined
      ? ''
      : rateWindowLabel(spend.rateWindowMinutes)
  const advance = nextModelCaret(spend.provider)
  const tail = `${suffix} ${advance}`
  return `${osc8Href(meta.dashboardUrl, meter)}${color ? paintSolid(tail, displayRgb) : tail}`
}

/**
 * Every offload gauge. The Claude seat is gauge 0, so providers start at 1.
 */
export function formatOffloadGauges(
  spends: readonly ProviderSpend[],
  options?: OffloadGaugeOptions | undefined,
): string {
  const opts = { __proto__: null, ...options } as OffloadGaugeOptions
  if (spends.length === 0) {
    return ''
  }
  const total = spends.length + 1
  const colliding = collidingGaugeNames(spends)
  const nowMs = opts.nowMs ?? Date.now()
  return spends
    .map(
      (spend, i) =>
        `  ${formatOffloadGauge(spend, {
          availabilityTable: opts.availabilityTable,
          color: opts.color,
          inactive: !isProviderActive(spend),
          index: i + 1,
          labelProvider: colliding.has(gaugeModelName(spend)),
          nowMs,
          total,
        })}`,
    )
    .join('')
}

/**
 * The config the line renderer takes: a budget, the resolved spend snapshot,
 * the resolved offload spends (model names pre-set), the claude seat label, and
 * the report path. The report path is present only when the report file exists.
 */
export interface StatuslineRenderConfig {
  readonly budget: BudgetConfig
  readonly color?: boolean | undefined
  readonly model?: string | undefined
  readonly offload?: readonly ProviderSpend[] | undefined
  readonly availabilityTable?: AvailabilityTable | undefined
  readonly nowMs?: number | undefined
  readonly reportPath?: string | undefined
  readonly snapshot: { readonly usd: number }
}

/**
 * The neutral line when no budget is configured.
 */
export function neutralSpendLine(model: string | undefined): string {
  return `${meterGlyphFor('target')} no budget configured${model ? ` · ${model}` : ''}`
}

/**
 * The rendered line: the offload gauges, then the Claude meter, tier alert, and
 * caret. The Claude seat is LAST (the fallback seat, not the lead).
 */
export function formatSpendStatusline(config: StatuslineRenderConfig): string {
  const cfg = { __proto__: null, ...config } as StatuslineRenderConfig
  const { budget, snapshot } = cfg
  const offloadSpends = cfg.offload ?? []
  const total = offloadSpends.length + 1
  const isOffloaded = claudeSeatIsParked()
  const claudeRemaining = remainingForBudget(snapshot.usd, budget)
  const rgb = isOffloaded
    ? INACTIVE_RGB
    : claudeRemaining !== undefined && claudeRemaining < 1
      ? gaugeColor({ index: total - 1, remaining: claudeRemaining, total })
      : INACTIVE_RGB
  const seatName = cfg.model ?? 'claude'
  const meter =
    cfg.color === true
      ? paintGaugeBar({
          color: true,
          name: seatName,
          remaining: claudeRemaining,
          rgb,
          width: GAUGE_WIDTH,
        })
      : `${renderSpendMeter(snapshot.usd, budget)} · ${seatName}`
  const linked =
    cfg.reportPath === undefined || isOffloaded
      ? meter
      : osc8Link(cfg.reportPath, meter)
  const caret = isOffloaded
    ? ''
    : cfg.color === true
      ? paintSolid(nextModelCaret(CLAUDE_TARGET), rgb)
      : nextModelCaret(CLAUDE_TARGET)
  const tier = tierFor(snapshot.usd, budget)
  const alert =
    cfg.color !== true || tier === 'target' ? '' : meterGlyphFor(tier)
  const head = `${offloadSpends.length > 0 ? '  ' : ''}${linked}${alert}${caret}`
  const offload = formatOffloadGauges(offloadSpends, {
    availabilityTable: cfg.availabilityTable,
    color: cfg.color === true,
    nowMs: cfg.nowMs,
  })
  return `${offload}${head}`
}
