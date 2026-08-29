/**
 * @file Scheduled integrity-refresh job for the fleet's external-tools pins.
 *   Two passes over every entry in external-tools.json: Re-verify (freshness):
 *   for every integrity pin carrying src + date (the object provenance form -
 *   Go, rustup, Google Chrome), fetch the publisher's CURRENT checksum from src
 *   and compare it to integrity.value. When they MATCH, the pin is still valid
 *   → auto-bump integrity.date to today (the pin is re-verified, no manual
 *   work). When they DIFFER, the publisher changed the checksum → flag it for
 *   manual re-pinning (the pin is stale / re-released / possibly compromised).
 *   Re-evaluate (currency): for every entry with a version, check the publisher
 *   for a NEWER version (per origin: go.dev manifest for go, crates.io for
 *   cargo, npm registry for npm, GitHub releases for
 *   gh-asset/gh-asset/git/rustup, nodejs.org dist for node-dist). A newer
 *   version is FLAGGED for evaluation - never auto-bumped (version bumps need
 *   soak/testing). Output: rewrites external-tools.json in place (auto-bumps
 *   verified dates) + commits the change, and prints a report of flagged items
 *   (stale checksum / newer version). Issue-opening is a follow-up; this job
 *   just reports. Runs after setup-node so it CAN import the lib-stable package
 *   (unlike the dep-0 _shared helpers). The network is injectable so unit tests
 *   mock it without touching the wire. Testability: the pure planners
 *   (reverifyPin, latestVersionFor, refreshToolsConfig) are EXPORTED and take
 *   an injectable fetchImpl + clock; the side-effectful CLI
 *   (read/write/commit/report) is guarded by isMainModule().
 */

import { readFileSync, writeFileSync } from 'node:fs'
import process from 'node:process'

import { httpRequest } from '@socketsecurity/lib-stable/http-request'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { gt } from '@socketsecurity/lib-stable/versions/compare'
import { isValidVersion } from '@socketsecurity/lib-stable/versions/parse'

import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'

import {
  checksumsMatch,
  parseChecksumFile,
} from '../../../.github/actions/fleet/_shared/verify-integrity-provenance.mjs'

import type { ScriptMeta } from '../_shared/run-main.mts'
import type {
  ToolEntryType,
  ToolsConfigType,
} from '../lib/external-tools-schema.mts'

const logger = getDefaultLogger()

// ── types ─────────────────────────────────────────────────────────────────

/**
 * One platform's object-form integrity pin (value + provenance).
 */
interface IntegrityPin {
  readonly value: string
  readonly src?: string | undefined
  readonly date?: string | undefined
}

/**
 * A re-verify outcome for one pin.
 */
export interface ReverifyResult {
  readonly matches: boolean
  readonly fetched: string
  readonly reason: string
}

/**
 * A currency check outcome for one tool.
 */
export interface CurrencyResult {
  readonly current: string
  readonly latest: string
  readonly hasNewer: boolean
  readonly reason: string
}

/**
 * One flagged item in the refresh report.
 */
export interface FlagItem {
  readonly tool: string
  readonly kind: 'stale-checksum' | 'newer-version'
  readonly detail: string
}

/**
 * The full refresh result: the rewritten config + the report.
 */
export interface RefreshResult {
  readonly updated: ToolsConfigType
  readonly flagged: FlagItem[]
  readonly dateBumps: string[]
  readonly changed: boolean
}

/**
 * A fetch impl that returns the response body text for a URL. Used everywhere
 * network is touched so tests inject a mock.
 */
export type FetchText = (url: string) => Promise<string>

// ── re-verify (freshness) ─────────────────────────────────────────────────

/**
 * Fetch the publisher's current checksum from `pin.src`, parse it, and compare
 * to `pin.value`. `assetFilename` picks the matching entry out of a multi-file
 * checksum body (SHASUMS, go.dev JSON manifest, Debian Packages index). Pure
 * given the injected `fetchText`. Returns `{ matches, fetched, reason }`.
 */
export async function reverifyPin(
  pin: IntegrityPin,
  fetchText: FetchText,
  options?: { assetFilename?: string | undefined } | undefined,
): Promise<ReverifyResult> {
  const { assetFilename = '' } = { __proto__: null, ...options } as NonNullable<
    typeof options
  >
  if (!pin.src) {
    return {
      matches: false,
      fetched: '',
      reason: 'no src — nothing to re-verify',
    }
  }
  let text: string
  try {
    text = await fetchText(pin.src)
  } catch (e) {
    return {
      matches: false,
      fetched: '',
      reason: `fetch failed for ${pin.src}: ${errorMessage(e)}`,
    }
  }
  const fetched = parseChecksumFile(text, { assetFilename })
  if (!fetched) {
    return {
      matches: false,
      fetched: '',
      reason: `could not parse a checksum from ${pin.src} for ${assetFilename || '(asset)'}`,
    }
  }
  const matches = checksumsMatch(pin.value, fetched)
  return {
    matches,
    fetched,
    reason: matches
      ? 'pin still matches the publisher'
      : `pin ${pin.value} != publisher ${fetched} from ${pin.src}`,
  }
}

// ── re-evaluate (currency) ────────────────────────────────────────────────

// Parse `github:owner/repo` → `owner/repo`. Returns '' for a non-github repo.
function parseGithubRepo(repository: string | undefined): string {
  if (typeof repository !== 'string') {
    return ''
  }
  const m = /^github:([^/]+\/[^/]+)$/.exec(repository)
  return m ? (m[1] ?? '') : ''
}

// Strip a leading `v` from a version tag (GitHub release tags carry one; the
// pin is usually bare). Tolerant of `v1.2.3` and `1.2.3`.
function stripV(v: string): string {
  return v.startsWith('v') || v.startsWith('V') ? v.slice(1) : v
}

/**
 * Fetch the publisher's latest version for a tool entry, per origin. Returns
 * `{ current, latest, hasNewer, reason }` or `undefined` when the origin has no
 * version check (system / unknown manager). Pure given the injected fetchText.
 * `current` is the entry's pinned `version` (stripped of a leading `v` for the
 * comparison). `hasNewer` uses the lib's `gt` semver compare so a back-line
 * patch published after a newer major does not register as "newer".
 */
export async function latestVersionFor(
  name: string,
  entry: ToolEntryType,
  fetchText: FetchText,
): Promise<CurrencyResult | undefined> {
  const current = stripV(String(entry.version ?? ''))
  if (!current) {
    return undefined
  }
  let latest = ''
  let reason = ''

  switch (entry.origin) {
    case 'manager': {
      if (entry.manager === 'go') {
        latest = await latestGoVersion(fetchText)
        reason = 'go.dev release manifest'
      } else if (entry.manager === 'rustup') {
        latest = await latestGithubRelease('rust-lang/rustup', fetchText)
        reason = 'GitHub releases (rust-lang/rustup)'
      } else {
        return undefined // nvm/fnm/uv/volta/mise/asdf: no single latest endpoint.
      }
      break
    }
    case 'cargo': {
      latest = await latestCratesVersion(entry.crate, fetchText)
      reason = `crates.io API (${entry.crate})`
      break
    }
    case 'npm': {
      const repo = entry.repository
      const pkg =
        typeof repo === 'string' && repo.startsWith('npm:')
          ? repo.slice('npm:'.length)
          : name
      latest = await latestNpmVersion(pkg, fetchText)
      reason = `npm registry (${pkg})`
      break
    }
    case 'gh-asset':
    case 'gh-archive':
    case 'git': {
      const repo = parseGithubRepo(entry.repository)
      if (!repo) {
        return undefined
      }
      latest = await latestGithubRelease(repo, fetchText)
      reason = `GitHub releases (${repo})`
      break
    }
    case 'node-dist': {
      latest = await latestNodeVersion(fetchText)
      reason = 'nodejs.org dist index'
      break
    }
    case 'system':
      return undefined
    default:
      return undefined
  }

  if (!latest) {
    return {
      current,
      latest: '',
      hasNewer: false,
      reason: `${reason} — no latest resolved`,
    }
  }
  const latestClean = stripV(latest)
  const hasNewer =
    isValidVersion(current) && isValidVersion(latestClean)
      ? gt(latestClean, current)
      : latestClean !== current
  return { current, latest: latestClean, hasNewer, reason }
}

// go.dev manifest → latest stable release version (strip the `go` prefix).
async function latestGoVersion(fetchText: FetchText): Promise<string> {
  try {
    const text = await fetchText('https://go.dev/dl/?mode=json&include=all')
    const manifest = JSON.parse(text) as Array<{
      version: string
      stable: boolean
    }>
    const release = manifest.find(r => r.stable)
    // go.dev versions carry a `go` prefix (go1.27.0); strip it so `latest`
    // is bare semver matching the `current` pin format.
    return release ? stripV(release.version.replace(/^go/i, '')) : ''
  } catch {
    return ''
  }
}

// GitHub releases latest API → tag_name.
async function latestGithubRelease(
  repo: string,
  fetchText: FetchText,
): Promise<string> {
  try {
    const text = await fetchText(
      `https://api.github.com/repos/${repo}/releases/latest`,
    )
    const data = JSON.parse(text) as { tag_name?: unknown | undefined }
    return typeof data.tag_name === 'string' ? data.tag_name : ''
  } catch {
    return ''
  }
}

// crates.io API → max_stable_version.
async function latestCratesVersion(
  crate: string,
  fetchText: FetchText,
): Promise<string> {
  try {
    const text = await fetchText(`https://crates.io/api/v1/crates/${crate}`)
    const data = JSON.parse(text) as {
      crate?: { max_stable_version?: unknown | undefined } | undefined
    }
    const v = data.crate?.max_stable_version
    return typeof v === 'string' ? v : ''
  } catch {
    return ''
  }
}

// npm registry packument → dist-tags.latest.
async function latestNpmVersion(
  pkg: string,
  fetchText: FetchText,
): Promise<string> {
  try {
    const text = await fetchText(
      `https://registry.npmjs.org/${encodeURIComponent(pkg)}`,
    )
    const data = JSON.parse(text) as {
      'dist-tags'?: { latest?: unknown | undefined } | undefined
    }
    const v = data['dist-tags']?.latest
    return typeof v === 'string' ? v : ''
  } catch {
    return ''
  }
}

// nodejs.org dist index → latest version. The first entry is the newest.
async function latestNodeVersion(fetchText: FetchText): Promise<string> {
  try {
    const text = await fetchText('https://nodejs.org/dist/index.json')
    const index = JSON.parse(text) as Array<{ version?: string | undefined }>
    const first = index[0]?.version
    return typeof first === 'string' ? stripV(first) : ''
  } catch {
    return ''
  }
}

// ── orchestrator (pure given injected fetchText + now) ────────────────────

/**
 * Walk every tool entry in a ToolsConfig: re-verify each object-form integrity
 * pin (auto-bumping `date` on a match), and check each `version` for a newer
 * release. Returns the rewritten config (dates bumped) + a report of flagged
 * items. Does NOT mutate the input — returns a deep-ish copy with updated
 * `date` fields. Pure given `fetchText` + `now`.
 */
export async function refreshToolsConfig(
  config: ToolsConfigType,
  opts: {
    fetchText?: FetchText | undefined
    now?: Date | (() => Date) | undefined
  } = {},
): Promise<RefreshResult> {
  const fetchText = opts.fetchText || defaultFetchText
  const nowOpt = opts.now
  const now =
    typeof nowOpt === 'function'
      ? nowOpt()
      : nowOpt instanceof Date
        ? nowOpt
        : new Date()
  const today = now.toISOString().slice(0, 10)

  const flagged: FlagItem[] = []
  const dateBumps: string[] = []
  // Clone so the input is untouched; only `date` strings are rewritten. The
  // config is JSON-roundtrippable (it came from JSON.parse), so the JSON
  // round-trip is cheaper than the structured-clone algorithm.
  const updated: ToolsConfigType = JSON.parse(JSON.stringify(config))

  for (const [name, entry] of Object.entries(updated.tools)) {
    // ── re-verify each object-form integrity pin ────────────────────────
    const pins = collectIntegrityPins(entry)
    let allMatch = true
    for (const pin of pins) {
      if (!pin.src) {
        continue
      }
      const assetFilename = basenameOf(pin.assetName || '')
      const r = await reverifyPin(pin, fetchText, { assetFilename })
      if (!r.matches) {
        allMatch = false
        flagged.push({
          tool: name,
          kind: 'stale-checksum',
          detail: r.reason,
        })
      }
    }
    // Bump `date` to today for every reverified pin (only when ALL matched,
    // so a single mismatch doesn't refresh the audit trail for the others).
    if (allMatch && pins.some(p => p.src)) {
      bumpIntegrityDates(entry, today)
      dateBumps.push(name)
    }

    // ── re-evaluate currency ────────────────────────────────────────────
    if (entry.version) {
      const c = await latestVersionFor(name, entry, fetchText)
      if (c?.hasNewer) {
        flagged.push({
          tool: name,
          kind: 'newer-version',
          detail: `pinned at ${c.current}, but ${c.latest} is available — consider bumping (${c.reason})`,
        })
      }
    }
  }

  const changed =
    dateBumps.length > 0 || JSON.stringify(updated) !== JSON.stringify(config)
  return { updated, flagged, dateBumps, changed }
}

// One integrity pin + the asset filename it belongs to (for checksum matching
// inside a multi-file body like the go.dev manifest).
interface CollectedPin extends IntegrityPin {
  readonly assetName: string
}

// Collect every object-form integrity pin on an entry — per-platform (under
// `platforms`) and the top-level `integrity` (npm origin). String-form pins
// are skipped (no provenance to re-verify). Mutates nothing.
function collectIntegrityPins(entry: ToolEntryType): CollectedPin[] {
  const out: CollectedPin[] = []
  const platforms = (
    entry as { platforms?: Record<string, unknown> | undefined }
  ).platforms
  if (platforms !== null && typeof platforms === 'object') {
    for (const [key, pe] of Object.entries(platforms)) {
      if (pe !== null && typeof pe === 'object') {
        const p = pe as {
          asset?: string | undefined
          integrity?: unknown | undefined
        }
        const pin = asPin(p.integrity)
        if (pin) {
          out.push({
            ...pin,
            assetName: typeof p.asset === 'string' ? p.asset : key,
          })
        }
      }
    }
  }
  const topPin = asPin((entry as { integrity?: unknown | undefined }).integrity)
  if (topPin) {
    out.push({ ...topPin, assetName: '' })
  }
  return out
}

// Narrow an `unknown` integrity to the object provenance form. Returns
// undefined for the string form (no provenance) or a non-object. With
// exactOptionalPropertyTypes, `src`/`date` are only included when they're
// strings (a `src: undefined` is NOT assignable to `src?: string`).
function asPin(integrity: unknown): IntegrityPin | undefined {
  if (typeof integrity !== 'object' || integrity === null) {
    return undefined
  }
  const p = integrity as {
    value?: unknown | undefined
    src?: unknown | undefined
    date?: unknown | undefined
  }
  if (typeof p.value !== 'string') {
    return undefined
  }
  const pin: {
    value: string
    src?: string | undefined
    date?: string | undefined
  } = { value: p.value }
  if (typeof p.src === 'string') {
    pin.src = p.src
  }
  if (typeof p.date === 'string') {
    pin.date = p.date
  }
  return pin
}

// Bump every object-form `integrity.date` on an entry to `today`. Mutates the
// entry in place (the cloned one). Skips pins without a `date` field already
// set. A provenance date that was never pinned is not invented here.
function bumpIntegrityDates(entry: ToolEntryType, today: string): void {
  const platforms = (
    entry as { platforms?: Record<string, unknown> | undefined }
  ).platforms
  if (platforms !== null && typeof platforms === 'object') {
    const platformValues = Object.values(platforms)
    for (let i = 0, { length } = platformValues; i < length; i += 1) {
      const pe = platformValues[i]!
      if (pe !== null && typeof pe === 'object') {
        const p = pe as { integrity?: unknown | undefined }
        bumpIfObject(p.integrity, today)
      }
    }
  }
  bumpIfObject((entry as { integrity?: unknown | undefined }).integrity, today)
}

function bumpIfObject(integrity: unknown, today: string): void {
  if (typeof integrity !== 'object' || integrity === null) {
    return
  }
  const p = integrity as { date?: unknown | undefined }
  // Only bump when a date is already set — the refresh re-verifies, it does
  // not invent provenance for a pin that never carried it.
  if (typeof p.date === 'string') {
    p.date = today
  }
}

// Basename of a URL or path. The asset filename is what checksum matching reads.
function basenameOf(p: string): string {
  if (!p) {
    return p
  }
  const segs = p.split(/[\\/]/)
  return segs[segs.length - 1] || p
}

// ── CLI (guarded) ─────────────────────────────────────────────────────────

const meta: ScriptMeta = {
  describe:
    'Re-verify integrity provenance + re-evaluate pinned versions for external-tools.json',
  help: 'Usage: pnpm run integrity-refresh [--tools-file <path>] [--dry-run] [--no-commit]',
}

// Wrap the lib-stable httpRequest as a FetchText (returns body text). Bounded
// at 30s so one stalled socket doesn't park the whole sweep. Errors propagate
// to reverifyPin / latestVersionFor, which already turn them into a flag/miss.
async function defaultFetchText(url: string): Promise<string> {
  const res = await httpRequest(url, { timeout: 30_000 })
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`)
  }
  return res.text()
}

function argValue(argv: string[], name: string): string {
  const i = argv.indexOf(name)
  return i >= 0 && i + 1 < argv.length ? (argv[i + 1] ?? '') : ''
}

async function main(argv: string[]): Promise<number> {
  const toolsFile =
    argValue(argv, '--tools-file') || 'scripts/fleet/setup/external-tools.json'
  const dryRun = argv.includes('--dry-run')
  const noCommit = argv.includes('--no-commit')

  let raw: string
  try {
    raw = readFileSync(toolsFile, 'utf8')
  } catch (e) {
    logger.fail(`could not read ${toolsFile}: ${errorMessage(e)}`)
    return 1
  }
  const config = JSON.parse(raw) as ToolsConfigType

  const result = await refreshToolsConfig(config, {
    fetchText: defaultFetchText,
  })

  // Report.
  if (result.dateBumps.length > 0) {
    logger.success(`re-verified + date-bumped: ${result.dateBumps.join(', ')}`)
  }
  if (result.flagged.length > 0) {
    logger.log('')
    logger.log('Flagged items (need manual attention):')
    for (const f of result.flagged) {
      logger.log(`  • ${f.tool} [${f.kind}]: ${f.detail}`)
    }
  }
  if (!result.dateBumps.length && !result.flagged.length) {
    logger.success('nothing to refresh — all pins current + verified')
  }

  if (dryRun || !result.changed) {
    return 0
  }

  // Write the updated JSON.
  writeFileSync(toolsFile, JSON.stringify(result.updated, null, 2) + '\n')

  if (noCommit) {
    logger.success(`wrote ${toolsFile} (--no-commit: left unstaged)`)
    return 0
  }

  // Commit. The job is a scheduled sweep; the commit is the audit trail that
  // the pin was re-verified on this date.
  const { spawnSync } =
    await import('@socketsecurity/lib-stable/process/spawn/child')
  const msg = `chore(integrity): refresh provenance dates (${result.dateBumps.join(', ')})`
  spawnSync('git', ['add', toolsFile], { stdio: 'inherit' })
  const r = spawnSync('git', ['commit', '-m', msg], { stdio: 'inherit' })
  if (r.status !== 0) {
    logger.fail(`git commit failed (exit ${r.status})`)
    return 1
  }
  logger.success(`committed: ${msg}`)
  return 0
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) {
    return e.message
  }
  return String(e)
}

if (isMainModule(import.meta.url)) {
  runMain(() => main(process.argv.slice(2)), meta)
}
