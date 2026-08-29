#!/usr/bin/env node
/**
 * @file `spend-forecast` — where this month's spend lands against the
 *   allowance, and what the pace has to become to land inside it. Measurement
 *   is NOT duplicated here. The scan comes from `claude-usage.mts`, the same
 *   one the terminal report and the HTML report read. Those price per model;
 *   this prices per DAY at the month's own model mix, because a forecast needs
 *   a daily series and the scan does not key tokens by day AND model. The two
 *   totals agree to within the drift of that mix. What this adds is the forward
 *   half: a trailing burn rate, a month-end projection, and the per-day
 *   headroom left to land on the allowance. It is also the ALLOWANCE'S WRITER.
 *   The budget file was hand-maintained, which is how its ceiling came to read
 *   $25k while the month had already spent $40k — three monthly figures with no
 *   single source. `--allowance N` derives all three tiers from one number, so
 *   they cannot drift apart again. Exits 2 when the projection lands over the
 *   allowance, so it can gate. Usage: node scripts/fleet/spend-forecast.mts
 *   node scripts/fleet/spend-forecast.mts --allowance 50000.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import { parseArgs } from '@socketsecurity/lib-stable/argv/parse'
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  budgetConfigPaths,
  costUsage,
  readBudgetConfig,
  scanUsage,
} from './_shared/claude-usage.mts'
import { isMainModule } from './_shared/is-main-module.mts'
import { runMain } from './_shared/run-main.mts'
import {
  BURN_WINDOW_DAYS,
  burnRate,
  monthProgress,
  projectSpend,
  tiersForAllowance,
  utcDayKey,
} from './_shared/spend-projection.mts'
import { findModelPricing, loadPricing } from './estimate-ai-cost.mts'

import type { ModelRate, UsageScan } from './_shared/claude-usage.mts'
import type { SpendProjection } from './_shared/spend-projection.mts'
import type { ScriptMeta } from './_shared/run-main.mts'
import type { PricingData } from './estimate-ai-cost.mts'

const logger = getDefaultLogger()

const EXIT_OVER_ALLOWANCE = 2
const MS_PER_DAY = 86_400_000

/**
 * Whole dollars. Cents in a five-figure forecast are noise.
 */
export function money(usd: number): string {
  return `$${Math.round(usd).toLocaleString('en-US')}`
}

/**
 * One rate standing in for the month's whole model mix.
 *
 * The scan keys tokens by day and by model separately, never both, so a day's
 * cost cannot be priced model by model. This weights each model's published
 * rate by the tokens that model actually consumed, which prices a day at the
 * mix the month itself ran - and the input and output legs are weighted
 * SEPARATELY, because output costs several times input and one flat
 * tokens-per-dollar blend would price a read-heavy day like a write-heavy one.
 */
export function blendedRate(scan: UsageScan, pricing: PricingData): ModelRate {
  let inputTokens = 0
  let inputWeighted = 0
  let outputTokens = 0
  let outputWeighted = 0
  for (const [model, totals] of scan.byModel) {
    const rate = findModelPricing(pricing, model)?.model
    if (!rate?.inputPerMtok || !rate.outputPerMtok) {
      continue
    }
    // Cache reads and writes are priced off the INPUT rate, so they weight it.
    const onInput = totals.input + totals.cacheWrite + totals.cacheRead
    inputTokens += onInput
    inputWeighted += onInput * rate.inputPerMtok
    outputTokens += totals.output
    outputWeighted += totals.output * rate.outputPerMtok
  }
  return {
    inputPerMtok: inputTokens > 0 ? inputWeighted / inputTokens : 0,
    outputPerMtok: outputTokens > 0 ? outputWeighted / outputTokens : 0,
  }
}

/**
 * Daily spend in USD, keyed the way the scan keys it.
 */
export function dailySpendUsd(
  scan: UsageScan,
  pricing: PricingData,
): Map<string, number> {
  const anthropic = pricing.services?.['anthropic']
  const rate = blendedRate(scan, pricing)
  const out = new Map<string, number>()
  for (const [day, totals] of scan.byDay) {
    const cost = costUsage(totals, rate, anthropic?.multipliers ?? {})
    out.set(day, cost?.totalUsd ?? 0)
  }
  return out
}

/**
 * The forecast as label/value rows, so the shape is testable without a
 * terminal and the caller owns the indentation.
 */
export function forecastRows(projection: SpendProjection): string[] {
  const {
    allowanceUsd,
    burnUsdPerDay,
    daysRemaining,
    headroomUsdPerDay,
    overshootUsd,
    projectedUsd,
    remainingUsd,
    requiredCut,
    spentUsd,
    verdict,
  } = projection
  const rows = [
    `Spent      ${money(spentUsd)} of ${money(allowanceUsd)}`,
    `Remaining  ${money(remainingUsd)} over ${daysRemaining.toFixed(1)} days`,
    `Pace       ${money(burnUsdPerDay)}/day (trailing ${BURN_WINDOW_DAYS} days, today excluded)`,
    `Allowed    ${money(headroomUsdPerDay)}/day to land on the allowance`,
    `Projected  ${money(projectedUsd)} by month end`,
  ]
  if (verdict === 'over') {
    rows.push(
      `Verdict    OVER by ${money(overshootUsd)}, cut ${Math.round(requiredCut * 100)}% off the current pace`,
    )
  } else if (verdict === 'tight') {
    rows.push('Verdict    TIGHT, inside the allowance with little to spare')
  } else {
    rows.push('Verdict    UNDER, the current pace fits')
  }
  return rows
}

/**
 * Rewrite the budget file's tiers from one allowance figure, preserving every
 * other field it carries.
 */
export async function writeAllowance(
  allowanceUsd: number,
  nowMs: number,
  candidates = budgetConfigPaths(),
): Promise<string> {
  const target = candidates[0]
  if (!target) {
    throw new Error('no budget config path to write to')
  }
  const existing = await readBudgetConfig(candidates)
  const { daysInMonth } = monthProgress(nowMs)
  const body = {
    schemaVersion: 2,
    currency: 'USD',
    tiers: tiersForAllowance(allowanceUsd, daysInMonth),
    warnEveryPct: existing?.warnEveryPct ?? 5,
    emergencyReserve: {
      monthly: Math.round(allowanceUsd * 0.02),
      perGrant: existing?.emergencyPerGrant ?? 50,
      ttlMinutes: existing?.emergencyTtlMinutes ?? 120,
    },
    privacy: { printAbsoluteFigures: existing?.printAbsoluteFigures === true },
  }
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, `${JSON.stringify(body, undefined, 2)}\n`, 'utf8')
  return target
}

export async function main(): Promise<number> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: { allowance: { type: 'string' } },
    strict: false,
  })
  const nowMs = Date.now()

  const requested = values['allowance']
  if (typeof requested === 'string') {
    const allowanceUsd = Number(requested)
    if (!Number.isFinite(allowanceUsd) || allowanceUsd <= 0) {
      logger.fail(
        `Not a monthly allowance: '${requested}'.\n` +
          'Where: --allowance\n' +
          'Saw: a value that is not a positive number of dollars\n' +
          'Fix: pass the month total, e.g. --allowance 50000',
      )
      return 1
    }
    try {
      const written = await writeAllowance(allowanceUsd, nowMs)
      logger.success(
        `Set the monthly allowance to ${money(allowanceUsd)} in ${written}`,
      )
    } catch (e) {
      logger.fail(`Could not write the budget: ${errorMessage(e)}`)
      return 1
    }
  }

  const { monthStartMs } = monthProgress(nowMs)
  // The burn window reaches back BEFORE the month starts near the 1st, so the
  // scan has to cover it or the pace reads as zero for a week.
  const scanFromMs = Math.min(
    monthStartMs,
    nowMs - BURN_WINDOW_DAYS * MS_PER_DAY,
  )
  let projection: SpendProjection
  let monthLabel: string
  try {
    const [scan, budget] = await Promise.all([
      scanUsage(scanFromMs, nowMs),
      readBudgetConfig(),
    ])
    const allowanceUsd = budget?.ceiling?.monthly ?? budget?.stretch.monthly
    if (!allowanceUsd) {
      logger.fail(
        'No monthly allowance is configured.\n' +
          `Where: ${budgetConfigPaths()[0]}\n` +
          'Saw: no budget file, or one with no ceiling tier\n' +
          'Fix: node scripts/fleet/spend-forecast.mts --allowance 50000',
      )
      return 1
    }
    const pricing = loadPricing()
    const daily = dailySpendUsd(scan, pricing)
    // Month-to-date only: the scan reaches back past the 1st for the burn
    // window near the start of a month, and last month's spend is not this
    // month's.
    const monthKey = utcDayKey(monthStartMs)
    let spentUsd = 0
    for (const [day, usd] of daily) {
      if (day >= monthKey) {
        spentUsd += usd
      }
    }
    projection = projectSpend({
      allowanceUsd,
      burnUsdPerDay: burnRate(daily, nowMs),
      nowMs,
      spentUsd,
    })
    monthLabel = new Date(monthStartMs).toLocaleDateString('en-US', {
      month: 'long',
      timeZone: 'UTC',
      year: 'numeric',
    })
  } catch (e) {
    logger.fail(`Could not build the forecast: ${errorMessage(e)}`)
    return 1
  }

  logger.group(`Spend forecast: ${monthLabel}`)
  for (const row of forecastRows(projection)) {
    logger.substep(row)
  }
  logger.groupEnd()
  return projection.verdict === 'over' ? EXIT_OVER_ALLOWANCE : 0
}

export const SCRIPT_META: ScriptMeta = {
  describe:
    "projects this month's spend against the allowance and prints the pace it needs",
  help: `Usage: node scripts/fleet/spend-forecast.mts [flags]

  --allowance N   set the monthly allowance to N dollars, then forecast

Exits 2 when the projection lands OVER the allowance, so a gate can read it.
The pace is measured over the trailing ${BURN_WINDOW_DAYS} days with today
excluded: a partial day always reads cheap, and including it makes every
forecast optimistic.`,
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
/* c8 ignore stop */
