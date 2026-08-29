/*
 * @file Month-end spend projection: where the current pace lands against the
 *   allowance, and what the pace has to become to land inside it.
 *
 *   WHY THIS IS NOT A MONTH-TO-DATE AVERAGE. Dividing spend by days elapsed
 *   answers "what has this month cost so far", which is the one thing already
 *   known. A forecast needs the CURRENT pace, so the burn rate is measured over
 *   a trailing window and today is excluded from it - a partial day always
 *   reads as a cheap day and drags the average down, which makes every forecast
 *   run optimistic in exactly the situation where that is most expensive.
 *
 *   Everything here is pure and UTC. The scan keys its daily totals by UTC date
 *   (`claude-usage.mts`), so a month window built in local time would put spend
 *   in the wrong month for up to a day either side of the boundary.
 */

// Trailing days the pace is measured over. Long enough that one heavy session
// does not dominate, short enough to notice a change of gear inside a week.
export const BURN_WINDOW_DAYS = 7

// Projected spend this close to the allowance is 'tight' rather than 'under':
// a forecast is an estimate, and landing at 97% of a ceiling is not a pass.
export const TIGHT_FRACTION = 0.95

/**
 * How far through the month the clock is, in UTC.
 */
export interface MonthProgress {
  // Fractional, so a forecast made at midday counts half a day.
  readonly daysElapsed: number
  readonly daysInMonth: number
  readonly daysRemaining: number
  readonly monthStartMs: number
}

export type SpendVerdict = 'over' | 'tight' | 'under'

export interface SpendProjection {
  readonly allowanceUsd: number
  // Measured over the trailing window, today excluded.
  readonly burnUsdPerDay: number
  readonly daysRemaining: number
  // What is left to spend per remaining day to land exactly on the allowance.
  readonly headroomUsdPerDay: number
  // Fraction the current pace has to drop by, 0 when the pace already fits.
  readonly requiredCut: number
  readonly overshootUsd: number
  readonly projectedUsd: number
  readonly remainingUsd: number
  readonly spentUsd: number
  readonly verdict: SpendVerdict
}

/**
 * The UTC calendar month `nowMs` falls in, and how much of it is left.
 */
export function monthProgress(nowMs: number): MonthProgress {
  const now = new Date(nowMs)
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth()
  const monthStartMs = Date.UTC(year, month, 1)
  const monthEndMs = Date.UTC(year, month + 1, 1)
  const dayMs = 86_400_000
  const daysInMonth = (monthEndMs - monthStartMs) / dayMs
  const daysElapsed = (nowMs - monthStartMs) / dayMs
  return {
    daysElapsed,
    daysInMonth,
    daysRemaining: Math.max(daysInMonth - daysElapsed, 0),
    monthStartMs,
  }
}

/**
 * The UTC `YYYY-MM-DD` key the scan files a timestamp under.
 */
export function utcDayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * Mean daily spend over the trailing `windowDays` before today.
 *
 * A day the operator did not work is a real zero and belongs in the mean, so
 * the window is divided by its LENGTH rather than by the number of days that
 * happen to have entries. Dividing by entries answers "what does a working day
 * cost", which forecasts a month with no weekends in it.
 */
export function burnRate(
  dailyUsd: ReadonlyMap<string, number>,
  nowMs: number,
  windowDays = BURN_WINDOW_DAYS,
): number {
  if (windowDays <= 0) {
    return 0
  }
  const dayMs = 86_400_000
  let total = 0
  for (let back = 1; back <= windowDays; back += 1) {
    total += dailyUsd.get(utcDayKey(nowMs - back * dayMs)) ?? 0
  }
  return total / windowDays
}

export interface ProjectSpendConfig {
  readonly allowanceUsd: number
  readonly burnUsdPerDay: number
  readonly nowMs: number
  readonly spentUsd: number
}

/**
 * Where the month lands, and what has to change for it to land inside the
 * allowance.
 */
export function projectSpend(config: ProjectSpendConfig): SpendProjection {
  const { allowanceUsd, burnUsdPerDay, nowMs, spentUsd } = config
  const { daysRemaining } = monthProgress(nowMs)
  const projectedUsd = spentUsd + burnUsdPerDay * daysRemaining
  const remainingUsd = Math.max(allowanceUsd - spentUsd, 0)
  // Divide by at least one day. A per-day rate is meaningless below a day, and
  // the naive divide turns the last minutes of the month into an absurdity:
  // $5,000 of headroom over the final second reads as $432 million a day, which
  // is a number a reader would act on.
  const headroomUsdPerDay = remainingUsd / Math.max(daysRemaining, 1)
  const overshootUsd = Math.max(projectedUsd - allowanceUsd, 0)
  const requiredCut =
    burnUsdPerDay > headroomUsdPerDay && burnUsdPerDay > 0
      ? 1 - headroomUsdPerDay / burnUsdPerDay
      : 0
  return {
    allowanceUsd,
    burnUsdPerDay,
    daysRemaining,
    headroomUsdPerDay,
    overshootUsd,
    projectedUsd,
    remainingUsd,
    requiredCut,
    spentUsd,
    verdict: verdictFor(projectedUsd, allowanceUsd),
  }
}

/**
 * Which side of the allowance a projection lands on.
 */
export function verdictFor(
  projectedUsd: number,
  allowanceUsd: number,
): SpendVerdict {
  if (allowanceUsd <= 0) {
    return 'over'
  }
  if (projectedUsd > allowanceUsd) {
    return 'over'
  }
  if (projectedUsd > allowanceUsd * TIGHT_FRACTION) {
    return 'tight'
  }
  return 'under'
}

/**
 * Budget tiers derived from ONE allowance figure, so the three monthly numbers
 * cannot disagree about what the month is allowed to cost.
 *
 * The daily figures are the tier spread flat across the month. They are a
 * reference pace, not the forecast: the forecast divides what is actually LEFT
 * by the days actually remaining, which is the number that moves.
 */
export function tiersForAllowance(
  allowanceUsd: number,
  daysInMonth: number,
): Record<
  'ceiling' | 'stretch' | 'target',
  { daily: number; monthly: number }
> {
  const monthly = (fraction: number): number =>
    Math.round(allowanceUsd * fraction)
  const spread = (value: number): number =>
    Math.round(value / Math.max(daysInMonth, 1))
  const target = monthly(0.9)
  const stretch = monthly(0.95)
  const ceiling = monthly(1)
  return {
    ceiling: { daily: spread(ceiling), monthly: ceiling },
    stretch: { daily: spread(stretch), monthly: stretch },
    target: { daily: spread(target), monthly: target },
  }
}
