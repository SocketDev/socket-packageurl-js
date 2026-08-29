/**
 * @file Render the spend report as ONE self-contained HTML file. Portless by
 *   construction: no server, no fetch, no CDN. Everything (style, script, data)
 *   is inlined, so the file opens straight off disk through a `file://` URL and
 *   works with the network off. It renders from the SAME row builders the text
 *   views use (`claude-usage-breakdowns.mts`), so the page and
 *   `report-claude-usage.mts` cannot disagree about a number. This module holds
 *   no measurement of its own. The theme is the dither ramp (` ░▒▓█`) and is
 *   FIXED. No toggle, no preference, no stored choice: one appearance means the
 *   shaded bars carry a single meaning everywhere they appear, here and in the
 *   terminal meter. Privacy: the budget's own figures print only when the
 *   budget opts in (`printAbsoluteFigures`), matching the statusline. Project
 *   labels are slugs already, and nothing account-identifying is ever written.
 */

import { meterFraction, tierFor } from './claude-usage.mts'
import { renderSelect } from './picker.mts'
import type { PickerGroup } from './picker.mts'
import {
  dayRows,
  projectRows,
  rankRows,
  speedRows,
} from './claude-usage-breakdowns.mts'

import type { BudgetConfig, UsageScan } from './claude-usage.mts'
import type { CacheMultipliers, ModelRate } from './claude-usage.mts'

// The dither ramp, lightest to darkest. Shared with the terminal meter so a
// filled bar reads the same in both places.
export const DITHER_RAMP: readonly string[] = ['░', '▒', '▓', '█']

// Bar cells in the HTML meter. Wider than the terminal's, because a page has
// room the statusline does not.
const METER_CELLS = 40

// Rows before the tail is summarised. rankRows never silently truncates.
const TOP_ROWS = 20

export interface SpendReportConfig {
  /**
   * The model picker's rows, one group per provider. Absent renders no picker,
   * which is what a report generated somewhere with no provider access shows.
   */
  pickers?: readonly PickerGroup[] | undefined
  readonly budget: BudgetConfig | undefined
  readonly generatedAtIso: string
  readonly models: Readonly<Record<string, ModelRate>>
  readonly multipliers: CacheMultipliers
  readonly scan: UsageScan
  readonly usd: number
  readonly windowFromIso: string
}

/**
 * Escape text for HTML text nodes and quoted attributes.
 *
 * Every dynamic value goes through this. Project labels come from directory
 * names on disk, which is untrusted enough: a directory can legally contain
 * `<`, `>`, `&`, or a quote, and one of those unescaped turns a local report
 * into a self-inflicted injection.
 */
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/**
 * A dither bar for a 0..1 fraction. Partial cells step through the ramp rather
 * than rounding, so a bar just past a cell boundary looks different from one
 * just short of it.
 */
export function ditherBar(
  fraction: number,
  cells: number = METER_CELLS,
): string {
  const clamped = Math.min(Math.max(fraction, 0), 1)
  const exact = clamped * cells
  const full = Math.floor(exact)
  const remainder = exact - full
  let bar = '█'.repeat(Math.min(full, cells))
  if (full < cells) {
    // Index 0 is the lightest shade, so an empty remainder stays empty.
    const step = Math.floor(remainder * DITHER_RAMP.length)
    bar += step > 0 ? DITHER_RAMP[step - 1]! : '░'
    bar += '░'.repeat(Math.max(cells - full - 1, 0))
  }
  return bar
}

function pct(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`
}

function money(usd: number): string {
  return `$${usd.toFixed(2)}`
}

/**
 * Whether this report may print dollar figures at all.
 */
export function showsFigures(budget: BudgetConfig | undefined): boolean {
  return budget?.printAbsoluteFigures === true
}

function shareCell(share: number): string {
  return `<span class="bar" aria-hidden="true">${ditherBar(share, 16)}</span><span class="num">${escapeHtml(pct(share))}</span>`
}

function table(
  caption: string,
  headers: readonly string[],
  bodyRows: readonly string[],
): string {
  const head = headers
    .map((h, i) => `<th${i === 0 ? '' : ' class="r"'}>${escapeHtml(h)}</th>`)
    .join('')
  return [
    '<section>',
    `<h2>${escapeHtml(caption)}</h2>`,
    // A sortable table is the one interaction worth having: the question is
    // always "what is biggest", and that changes column to column.
    '<table class="sortable"><thead><tr>',
    head,
    '</tr></thead><tbody>',
    ...bodyRows,
    '</tbody></table>',
    '</section>',
  ].join('\n')
}

function projectSection(config: SpendReportConfig): string {
  const rows = rankRows(
    projectRows(config.scan, config.models, config.multipliers),
    TOP_ROWS,
  )
  const figures = showsFigures(config.budget)
  const body = rows.map(row => {
    const cost = figures
      ? `<td class="r">${escapeHtml(money(row.usd))}</td>`
      : ''
    return `<tr><td>${escapeHtml(row.label)}</td><td class="r" data-sort="${row.share}">${shareCell(row.share)}</td>${cost}</tr>`
  })
  const headers = figures ? ['project', 'share', 'cost'] : ['project', 'share']
  return table(
    `By project (base rate, ${config.scan.byProject.size} projects)`,
    headers,
    body,
  )
}

function daySection(config: SpendReportConfig): string {
  const rows = dayRows(config.scan, config.models, config.multipliers)
  const peak = rows.reduce((max, row) => Math.max(max, row.usd), 0)
  const figures = showsFigures(config.budget)
  const body = rows.map(row => {
    const share = peak > 0 ? row.usd / peak : 0
    const cost = figures
      ? `<td class="r">${escapeHtml(money(row.usd))}</td>`
      : ''
    return `<tr><td>${escapeHtml(row.day)}</td><td class="r" data-sort="${share}">${shareCell(share)}</td><td class="r" data-sort="${row.requests}">${row.requests}</td>${cost}</tr>`
  })
  const headers = figures
    ? ['day', 'vs peak day', 'requests', 'cost']
    : ['day', 'vs peak day', 'requests']
  return table(`By day (${rows.length} days)`, headers, body)
}

function speedSection(config: SpendReportConfig): string {
  const rows = speedRows(config.scan, config.models, config.multipliers)
  const figures = showsFigures(config.budget)
  const body = rows.map(row => {
    const band =
      row.low === row.high
        ? money(row.low)
        : `${money(row.low)} to ${money(row.high)}`
    const cost = figures ? `<td class="r">${escapeHtml(band)}</td>` : ''
    return `<tr><td>${escapeHtml(row.speed)}</td><td class="r" data-sort="${row.requests}">${row.requests}</td>${cost}</tr>`
  })
  const headers = figures
    ? ['speed', 'requests', 'cost band']
    : ['speed', 'requests']
  return [
    table('By speed', headers, body),
    '<p class="note">Fast mode is priced as a band, floor to list. Cash does not identify where inside the band the truth sits, so the report refuses to pick a point.</p>',
  ].join('\n')
}

function dedupSection(config: SpendReportConfig): string {
  const { dedup } = config.scan
  const sound = dedup.keylessRecords === 0 && dedup.multiRequestMessageIds === 0
  const rows = [
    `<tr><td>records read</td><td class="r">${dedup.recordsSeen}</td></tr>`,
    `<tr><td>duplicates dropped</td><td class="r">${dedup.duplicatesDropped}</td></tr>`,
    `<tr><td>records with no key</td><td class="r">${dedup.keylessRecords}</td></tr>`,
    `<tr><td>ids split across requests</td><td class="r">${dedup.multiRequestMessageIds}</td></tr>`,
  ]
  const verdict = sound
    ? '<p class="ok">The dedup key held. Every billed request was counted once.</p>'
    : `<p class="warn">The dedup key did NOT hold, so these figures are wrong in a known direction: ${
        dedup.keylessRecords > 0
          ? 'unkeyed records make the total an OVERSTATEMENT'
          : 'ids split across requests make the total an UNDERSTATEMENT'
      }.</p>`
  return [
    table('Dedup soundness', ['measure', 'count'], rows),
    verdict,
    '<p class="note">This is the assumption every figure above rests on, shown rather than asserted: a request counted twice inflates the total, and one counted zero times hides it.</p>',
  ].join('\n')
}

function meterSection(config: SpendReportConfig): string {
  const { budget } = config
  if (!budget) {
    return '<section><h2>Budget</h2><p class="note">No budget is configured on this machine, so there is nothing to measure spend against. The report still shows where the spend went.</p></section>'
  }
  // The ceiling tier is optional, and it is the bar's upper bound, so without
  // it there is no meter to draw. meterFraction measures against a USD amount
  // rather than the config, so the monthly ceiling is what it takes.
  const { ceiling } = budget
  if (!ceiling) {
    return '<section><h2>Budget</h2><p class="note">This budget configures no ceiling tier, so there is no upper bound to measure against and no meter to draw. The report still shows where the spend went.</p></section>'
  }
  const tier = tierFor(config.usd, budget)
  const fraction = meterFraction(config.usd, ceiling.monthly)
  const left = Math.max(1 - fraction, 0)
  const figures = showsFigures(budget)
  const amounts = figures
    ? `<p class="num">${escapeHtml(money(config.usd))} of ${escapeHtml(money(ceiling.monthly))}</p>`
    : '<p class="note">Absolute figures are withheld: this budget sets printAbsoluteFigures to false.</p>'
  return [
    '<section>',
    '<h2>Token spend meter</h2>',
    `<pre class="meter ${escapeHtml(tier)}" aria-label="spend meter">[${ditherBar(fraction)}]</pre>`,
    `<p><strong>${escapeHtml(pct(left))} left</strong> · tier <strong>${escapeHtml(tier)}</strong></p>`,
    amounts,
    '</section>',
  ].join('\n')
}

// Inlined so the file is self-contained. The palette is the dither ramp's own
// greyscale plus one accent per tier, matching the terminal meter's neutral →
// orange → red progression.
const STYLE = `
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body {
  background: #0b0b0c;
  color: #d6d6d8;
  font: 14px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace;
  margin: 0 auto;
  max-width: 60rem;
  padding: 2rem 1.25rem 4rem;
}
h1 { font-size: 1.35rem; letter-spacing: 0.02em; margin: 0 0 0.25rem; }
h2 { border-bottom: 1px solid #26262a; font-size: 1rem; margin: 2.25rem 0 0.75rem; padding-bottom: 0.35rem; }
.sub { color: #85858c; margin: 0 0 1.5rem; }
.meter { font-size: 1.05rem; letter-spacing: 0.06em; margin: 0.5rem 0; overflow-x: auto; }
.meter.target { color: #9fd4a3; }
.meter.stretch { color: #e0a458; }
.meter.ceiling { color: #e2686b; }
table { border-collapse: collapse; width: 100%; }
th, td { padding: 0.3rem 0.55rem; text-align: left; }
th { color: #85858c; cursor: pointer; font-weight: 500; user-select: none; }
th:hover { color: #d6d6d8; }
th[aria-sort] { color: #d6d6d8; }
th.r, td.r { text-align: right; }
tbody tr:nth-child(odd) { background: #131315; }
.bar { color: #6f6f76; letter-spacing: 0.04em; margin-right: 0.6rem; }
.num { color: #d6d6d8; font-variant-numeric: tabular-nums; }
.note { color: #85858c; margin: 0.6rem 0 0; }
.ok { color: #9fd4a3; }
.warn { color: #e2686b; font-weight: 600; }
footer { border-top: 1px solid #26262a; color: #6f6f76; margin-top: 3rem; padding-top: 1rem; }
`

// One interaction: click a header to sort. Reads data-sort when present so a
// dithered share cell sorts by its number rather than its glyphs.
const SCRIPT = `
for (const table of document.querySelectorAll('table.sortable')) {
  const headers = [...table.tHead.rows[0].cells]
  headers.forEach((th, index) => {
    th.addEventListener('click', () => {
      const body = table.tBodies[0]
      const rows = [...body.rows]
      const descending = th.getAttribute('aria-sort') !== 'descending'
      const key = row => {
        const cell = row.cells[index]
        const raw = cell.dataset.sort ?? cell.textContent.trim()
        const asNumber = Number(String(raw).replace(/[$,%\\s]/g, ''))
        return Number.isNaN(asNumber) ? String(raw).toLowerCase() : asNumber
      }
      rows.sort((a, b) => {
        const left = key(a)
        const right = key(b)
        if (typeof left === 'number' && typeof right === 'number') {
          return descending ? right - left : left - right
        }
        return descending
          ? String(right).localeCompare(String(left))
          : String(left).localeCompare(String(right))
      })
      for (const row of rows) { body.append(row) }
      for (const other of headers) { other.removeAttribute('aria-sort') }
      th.setAttribute('aria-sort', descending ? 'descending' : 'ascending')
    })
  })
}
`

/**
 * The picker's save handler.
 *
 * POSTs to the reports server and reports the outcome beside the control. A
 * change that silently failed would be worse than no picker: the reader would
 * believe work had been repointed when it had not.
 */
export const PICKER_SCRIPT = `
document.querySelectorAll('.picker-row select').forEach(select => {
  select.addEventListener('change', async () => {
    const provider = select.name
    const note = document.querySelector('[data-saved-for="' + provider + '"]')
    if (note) { note.textContent = 'saving…' }
    try {
      const res = await fetch('/api/model-selection', {
        body: JSON.stringify({ model: select.value, provider: provider }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      })
      if (note) {
        note.textContent = res.ok ? 'saved' : 'not saved: ' + (await res.text())
      }
    } catch (e) {
      if (note) { note.textContent = 'not saved: ' + e.message }
    }
  })
})
`

/**
 * The model picker, one section per provider.
 *
 * Anchored `#picker-<provider>` because the statusline's caret links straight
 * to a provider's row - a single shared anchor would land a reader on the page
 * and leave them to find it.
 *
 * Rows are passed in rather than fetched here so the renderer stays pure: the
 * caller does the network read, and a report generated with no credential shows
 * the curated catalog instead of an empty menu.
 */
export function pickerSection(groups: readonly PickerGroup[]): string {
  if (groups.length === 0) {
    return ''
  }
  const blocks = groups.map(
    group => `<div class="picker-row" id="picker-${escapeHtml(group.name)}">
${renderSelect(group)}
<span class="saved" data-saved-for="${escapeHtml(group.name)}"></span>
</div>`,
  )
  return [
    '<section id="model-picker">',
    '<h2>Models</h2>',
    '<p class="sub">Changing one repoints the agents that route to that provider. Saved per machine; the CLI writes the same file.</p>',
    ...blocks,
    '</section>',
  ].join('\n')
}

/**
 * The whole report as one HTML document.
 */
export function renderSpendReportHtml(config: SpendReportConfig): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Token spend report</title>
<style>${STYLE}</style>
</head>
<body>
<h1>Token spend report</h1>
<p class="sub">Window opens ${escapeHtml(config.windowFromIso)} · generated ${escapeHtml(config.generatedAtIso)} · ${config.scan.filesScanned} transcript file(s), ${config.scan.totals.requests} billed request(s)</p>
${meterSection(config)}
${pickerSection(config.pickers ?? [])}
${projectSection(config)}
${daySection(config)}
${speedSection(config)}
${dedupSection(config)}
<footer>
<p>Rendered from the same row builders the terminal report uses, so the two cannot disagree. No network, no server: this file is complete on its own.</p>
</footer>
<script>${SCRIPT}</script>
<script>${PICKER_SCRIPT}</script>
</body>
</html>
`
}
