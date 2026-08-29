#!/usr/bin/env node
/*
 * @file The perry-compiled statusline entry: a SQLite-free, scan-free renderer
 *   that reads the spend snapshot plus fresh model names, availability, and
 *   budget, then prints the gauge line. On a cache miss it shells out to
 *   `node spend-statusline.mts --measure` to refresh the snapshot, then
 *   re-reads. No opencode SQLite, no transcript scan, no pricing - the heavy
 *   I/O stays in the Node producer. Perry compiles this to a native binary so
 *   the 2s poll is a few MB and a few ms, not a 161MB Node launch.
 *
 *   IT NEVER SPEAKS UP ON FAILURE. Every failure path prints nothing and exits
 *   0, so a broken render costs the previous line rather than pinning a stack
 *   trace into the chrome. No budget file prints the short neutral line.
 *
 *   Usage: node scripts/fleet/spend-statusline-render-entry.mts (or the perry
 *   binary). Claude Code writes the render payload to stdin.
 */

// perry cannot compile the external/ pack loader behind the fleet spawn, so
// it stays JS and its CJS interop wrapper mis-scopes node_process; the child is
// one fixed process.execPath call needing no PATH resolution.
// oxlint-disable-next-line socket/prefer-async-spawn -- fixed execPath child
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { access, readdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import { FLEET_CACHE_DIR } from './paths.mts'
import { isMainModule } from './_shared/is-main-module.mts'
import { readBudgetConfig } from './_shared/claude-usage.mts'
import { readAvailabilityTable } from './_shared/provider-availability.mts'
// From the leaf, not model-choices.mts: that module asks providers what they
// serve, which reads a credential and reaches socket-lib's keychain.
import { selectedModel } from './_shared/model-catalog.mts'
// From the leaf, not provider-models.mts: that module reads a credential,
// which reaches socket-lib's keychain and from there its spawn, and perry
// cannot compile that chain.
import { providerModelIsSelectable } from './_shared/provider-apis.mts'
import { readCodexModel } from './_shared/codex-model.mts'
import { claudeSettingsPath } from './_shared/claude-model.mts'
import { spendReportPath } from './_shared/spend-report-path.mts'
import {
  claudeSeatIsParked,
  formatSpendStatusline,
  neutralSpendLine,
} from './_shared/spend-statusline-render.mts'
import { GAUGE_PROVIDERS } from './_shared/offload-spend.mts'
import type { GaugeProvider, ProviderSpend } from './_shared/offload-spend.mts'

const SPEND_CACHE_DIR = path.join(FLEET_CACHE_DIR, 'socket-model-cost')
const SPEND_CACHE_TTL_MS = 300_000
const STDIN_TIMEOUT_MS = 250

interface OffloadSpendFigure {
  authoritativeRemaining?: number | undefined
  authoritativeUsd?: number | undefined
  messages: number
  rateWindowMinutes?: number | undefined
  usd: number
  windowRequests: number
}

interface SpendSnapshot {
  measuredAtMs: number
  offload?: Readonly<Record<GaugeProvider, OffloadSpendFigure>> | undefined
  requests: number
  unpricedModelCount: number
  usd: number
  windowFromMs: number
}

/**
 * The local midnight on the first of the current month - the window a
 * month-to-date spend snapshot covers.
 */
function monthStartMs(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), 1).getTime()
}

/**
 * Read stdin with a hard deadline. Claude Code writes the render payload and
 * closes the stream; the timeout only covers an inherited pipe nobody closes.
 */
function readPayload():
  | {
      model?:
        | { display_name?: string | undefined; id?: string | undefined }
        | undefined
    }
  | undefined {
  try {
    const chunks: Buffer[] = []
    const deadline = Date.now() + STDIN_TIMEOUT_MS
    while (Date.now() < deadline) {
      const buf = process.stdin.read()
      if (buf === null) {
        break
      }
      chunks.push(buf as Buffer)
    }
    const raw = Buffer.concat(chunks).toString('utf8').trim()
    if (raw.length === 0) {
      return undefined
    }
    return JSON.parse(raw) as {
      model?:
        | { display_name?: string | undefined; id?: string | undefined }
        | undefined
    }
  } catch {
    return undefined
  }
}

/**
 * The freshest servable snapshot in the cache, or undefined when none is fresh
 * enough for the current month.
 */
async function readSnapshot(
  windowFromMs: number,
  nowMs: number,
): Promise<SpendSnapshot | undefined> {
  let files: string[]
  try {
    files = await readdir(SPEND_CACHE_DIR)
  } catch {
    return undefined
  }
  let freshest: SpendSnapshot | undefined
  for (let i = 0, { length } = files; i < length; i += 1) {
    const name = files[i]!
    if (!name.endsWith('.json')) {
      continue
    }
    try {
      const parsed = JSON.parse(
        readFileSync(path.join(SPEND_CACHE_DIR, name), 'utf8'),
      ) as SpendSnapshot
      if (
        typeof parsed.measuredAtMs === 'number' &&
        parsed.windowFromMs === windowFromMs &&
        freshest === undefined
      ) {
        freshest = parsed
      } else if (
        typeof parsed.measuredAtMs === 'number' &&
        parsed.windowFromMs === windowFromMs &&
        typeof freshest?.measuredAtMs === 'number' &&
        parsed.measuredAtMs > freshest.measuredAtMs
      ) {
        freshest = parsed
      }
    } catch {
      // A malformed snapshot file is "nothing measured", never a thrown entry.
    }
  }
  if (freshest === undefined) {
    return undefined
  }
  const age = nowMs - freshest.measuredAtMs
  if (age < 0 || age >= SPEND_CACHE_TTL_MS) {
    return undefined
  }
  return freshest
}

/**
 * The model the Claude seat names, from settings or the stdin payload.
 */
function claudeModel(): string | undefined {
  try {
    const raw = readFileSync(claudeSettingsPath(), 'utf8')
    const settings = JSON.parse(raw) as { model?: unknown | undefined }
    if (typeof settings.model === 'string' && settings.model.length > 0) {
      return settings.model
    }
  } catch {
    // No settings file or no model key: the stdin payload's model is the
    // fallback, handled by the caller.
  }
  return undefined
}

/**
 * Build the offload ProviderSpend[] for the renderer: the snapshot's spend
 * figures plus the fresh model names (the selection file for selectable
 * providers, the codex config for the openai seat).
 */
function offloadSpends(snapshot: SpendSnapshot): ProviderSpend[] {
  const offload = snapshot.offload
  return GAUGE_PROVIDERS.map(provider => {
    const figure = offload?.[provider]
    return {
      messages: figure?.messages ?? 0,
      model: providerModelIsSelectable(provider)
        ? selectedModel(provider)
        : provider === 'openai'
          ? (readCodexModel() ?? '')
          : '',
      provider,
      usd: figure?.usd ?? 0,
      windowRequests: figure?.windowRequests ?? 0,
      ...(figure?.authoritativeRemaining !== undefined
        ? { authoritativeRemaining: figure.authoritativeRemaining }
        : {}),
      ...(figure?.authoritativeUsd !== undefined
        ? { authoritativeUsd: figure.authoritativeUsd }
        : {}),
      ...(figure?.rateWindowMinutes !== undefined
        ? { rateWindowMinutes: figure.rateWindowMinutes }
        : {}),
    }
  })
}

/**
 * Refresh the snapshot by shelling out to the Node producer's --measure mode,
 * then re-read. Best effort: a failure leaves the stale snapshot in place.
 */
async function refreshSnapshot(
  windowFromMs: number,
  nowMs: number,
): Promise<SpendSnapshot | undefined> {
  try {
    spawnSync(
      process.execPath,
      [
        path.join(
          FLEET_CACHE_DIR,
          '..',
          '..',
          'scripts',
          'fleet',
          'spend-statusline.mts',
        ),
        '--measure',
      ],
      { stdio: 'ignore' },
    )
  } catch {
    // A measure failure is "nothing refreshed", never a thrown render.
  }
  return readSnapshot(windowFromMs, nowMs)
}

export async function main(): Promise<number> {
  try {
    const payload = readPayload()
    const model =
      claudeModel() ?? payload?.model?.display_name ?? payload?.model?.id
    const budget = await readBudgetConfig()
    if (!budget) {
      process.stdout.write(`${neutralSpendLine(model)}\n`)
      return 0
    }
    const now = new Date()
    const nowMs = now.getTime()
    const windowFromMs = monthStartMs(now)
    let snapshot = await readSnapshot(windowFromMs, nowMs)
    if (snapshot === undefined) {
      snapshot = await refreshSnapshot(windowFromMs, nowMs)
    }
    if (snapshot === undefined) {
      // No snapshot and no refresh: print nothing, leave the previous line.
      return 0
    }
    const isOffloaded = claudeSeatIsParked()
    const seatName = isOffloaded ? (model ?? 'claude') : (model ?? 'claude')
    let reportPath: string | undefined
    try {
      const target = spendReportPath()
      await access(target)
      reportPath = target
    } catch {
      reportPath = undefined
    }
    process.stdout.write(
      `${formatSpendStatusline({
        availabilityTable: readAvailabilityTable(),
        budget,
        color: !process.env['NO_COLOR'] && process.env['TERM'] !== 'dumb',
        model: seatName,
        offload: offloadSpends(snapshot),
        reportPath,
        snapshot,
      })}\n`,
    )
  } catch {
    // Chrome must stay quiet.
  }
  return 0
}

// Deliberately not runMain: its logger reaches socket-lib's external/ pack
// loader, which perry cannot compile, and the resulting JS-interop wrapper
// mis-scopes node_process so the binary dies on startup. main() already
// swallows every failure and returns 0, so the harness adds nothing here.
if (isMainModule(import.meta.url)) {
  void (async () => {
    process.exitCode = await main()
  })()
}
