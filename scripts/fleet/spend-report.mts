#!/usr/bin/env node
/**
 * @file `spend-report` — render the token spend report to a single HTML file
 *   and print its path. Portless: the output is one self-contained file opened
 *   through `file://`, so there is no server, no port, and nothing listening.
 *   The statusline links to whatever this last wrote (`spend-report-path.mts`
 *   owns the location for both), so running this is what makes the meter
 *   clickable. It is also what refreshes the page: the file is a snapshot, not
 *   a live view, which is the trade a portless report makes. Measurement is NOT
 *   duplicated here. The scan comes from `claude-usage.mts` and every row from
 *   the builders `report-claude-usage.mts` uses, so the page and the terminal
 *   report cannot disagree about a number. Usage: node
 *   scripts/fleet/spend-report.mts [--days N] [--open] [--print].
 */

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

import { parseArgs } from 'node:util'
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { readBudgetConfig, scanUsage } from './spend/claude-usage.mts'
import { renderSpendReportHtml } from './spend/report-html.mts'
import { livePickerRowsFor } from './ai/model-choices.mts'
import { GAUGE_PROVIDERS, PROVIDER_META } from './spend/offload.mts'
import type { PickerGroup } from './cli/picker.mts'
import { reportHref } from './reports/url.mts'
import { spendReportPath } from './spend/report-path.mts'
import { ensureReportsServer } from './serve-reports.mts'
import { isMainModule } from './process/is-main-module.mts'
import { runMain } from './process/run-main.mts'
import { loadPricing } from './estimate-ai-cost.mts'
import { summarizeSpend } from './report-claude-usage.mts'

import type { ScriptMeta } from './process/run-main.mts'

const logger = getDefaultLogger()

export const DEFAULT_DAYS = 30
const MS_PER_DAY = 86_400_000

export interface ReportWindow {
  readonly fromMs: number
  readonly toMs: number
}

/**
 * The window the report covers, ending now.
 */
export function reportWindow(nowMs: number, days: number): ReportWindow {
  const span = Math.max(days, 1) * MS_PER_DAY
  return { fromMs: nowMs - span, toMs: nowMs }
}

/**
 * One picker group per provider, from each provider's live model list.
 *
 * A provider with no reachable credential falls back to the curated catalog, so
 * the menu is never empty - an empty dropdown reads as broken, a stale one
 * still works.
 */
export async function buildPickerGroups(): Promise<PickerGroup[]> {
  const groups: PickerGroup[] = []
  for (const provider of GAUGE_PROVIDERS) {
    groups.push({
      choices: await livePickerRowsFor(provider),
      name: provider,
      title: PROVIDER_META[provider].label,
    })
  }
  return groups
}

export async function main(): Promise<number> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      days: { type: 'string' },
      open: { type: 'boolean' },
      print: { type: 'boolean' },
    },
    strict: false,
  })
  const parsedDays = Number(values['days'])
  const days =
    Number.isInteger(parsedDays) && parsedDays > 0 ? parsedDays : DEFAULT_DAYS
  const nowMs = Date.now()
  const window = reportWindow(nowMs, days)

  let html: string
  const target = spendReportPath()
  try {
    const { 0: scan, 1: budget } = await Promise.all([
      scanUsage(window.fromMs, window.toMs),
      readBudgetConfig(),
    ])
    const pricing = loadPricing()
    // Same derivation the terminal report uses: the breakdown builders take one
    // service's rate table, and the total comes from summarizeSpend rather than
    // being re-added here.
    const anthropic = pricing.services?.['anthropic']
    html = renderSpendReportHtml({
      budget,
      generatedAtIso: new Date(nowMs).toISOString(),
      models: anthropic?.models ?? {},
      multipliers: anthropic?.multipliers ?? {},
      // Built here rather than in the renderer: listing a provider's models is
      // a network read, and a renderer that reached the network could not be
      // called from a test or rendered offline.
      pickers: await buildPickerGroups(),
      scan,
      usd: summarizeSpend(scan, pricing).pricedUsd,
      windowFromIso: new Date(window.fromMs).toISOString(),
    })
  } catch (e) {
    logger.fail(`Could not render the spend report: ${errorMessage(e)}`)
    return 1
  }

  if (values['print'] === true) {
    logger.log(html)
    return 0
  }

  try {
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, html, 'utf8')
  } catch (e) {
    logger.fail(`Could not write ${target}: ${errorMessage(e)}`)
    return 1
  }
  logger.success(`Wrote the spend report to ${target}`)

  // The report is addressed by its portless URL rather than its path, so the
  // link survives being pasted and the page gets a real origin to fetch from.
  // Serving is best effort: the file is written either way, and the fallback
  // href still opens it.
  const served = await ensureReportsServer()
  const href = served ? reportHref(target) : pathToFileURL(target).href
  if (!served) {
    logger.warn(
      `could not start the reports server; falling back to the file path`,
    )
  }
  logger.log(href)

  if (values['open'] === true) {
    // Best effort. A failure to launch a browser is not a failure to produce the
    // report, and the URL was already printed above.
    try {
      await spawn('open', [href], { stdio: 'ignore' })
    } catch (e) {
      logger.warn(`could not open the report: ${errorMessage(e)}`)
    }
  }
  return 0
}

export const SCRIPT_META: ScriptMeta = {
  describe:
    'renders the token spend report to one self-contained HTML file and prints its path',
  help: `Usage: node scripts/fleet/spend-report.mts [flags]

  --days N   days back to cover (default ${DEFAULT_DAYS})
  --open     open the written file in the default browser
  --print    write the HTML to stdout instead of to disk

The output is one file with its style and script inlined, so it opens over
file:// with the network off. The statusline links to the last file written here.`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
