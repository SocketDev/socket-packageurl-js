/**
 * @file The provider availability record, for CONSUMERS. The model-fallback
 *   watch daemon writes `~/.cache/fleet/provider-availability.json` on every
 *   probe pass - per ladder rung, whether it served and when it was last
 *   probed. This module is the read side, shared by the statusline (a down or
 *   stale seat draws the verifying pulse) and the offload model handler (a
 *   click answers from the last probe rather than guessing). STALENESS IS A
 *   STATE, NOT AN ERROR: a record older than the watch interval by a wide
 *   margin means the watcher is not running, which the pulse reports exactly
 *   like a missing record - "being verified", never "down".
 */

import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { PROVIDER_FIREWORKS, PROVIDER_OPENAI } from './offload-spend.mts'

export interface AvailabilityEntry {
  readonly probedAtMs: number
  readonly up: boolean
}

// The availability registry is a config document keyed by provider.
type AvailabilityMap = Readonly<
  // oxlint-disable-next-line socket/prefer-refined-record -- config doc
  Record<string, AvailabilityEntry>
>

export type AvailabilityTable = AvailabilityMap

export function availabilityPath(
  options?: { home?: string | undefined } | undefined,
): string {
  const opts = { __proto__: null, ...options } as {
    home?: string | undefined
  }
  const home = opts.home ?? os.homedir()
  return path.join(home, '.cache', 'fleet', 'provider-availability.json')
}

/**
 * How old a probe may be and still count as known. Twice the watch interval:
 * one missed pass is a flap, two means the watcher is not running.
 */
export const AVAILABILITY_STALE_MS = 120_000

export type ServingState = 'down' | 'unknown' | 'up'

/**
 * Whether a provider can SERVE right now, from the fallback watcher's probe
 * record. `up` means a fresh probe saw one of its rungs serve; `down` means
 * every fresh probe failed; `unknown` means no fresh probe exists - the
 * watcher is behind or not running, which renders as the verifying pulse.
 * `openai` is not a ladder provider, so the ladder's record says nothing
 * about it: its own rate-limit record is the answer, and this abstains.
 */
export function servingStateFor(
  provider: string,
  table: AvailabilityMap | undefined,
  nowMs: number,
): ServingState {
  if (provider === PROVIDER_OPENAI) {
    return 'up'
  }
  const prefix = provider === PROVIDER_FIREWORKS ? 'fireworks:' : `${provider}:`
  const fresh: AvailabilityEntry[] = []
  for (const [key, entry] of Object.entries(table ?? {})) {
    if (
      key.startsWith(prefix) &&
      nowMs - entry.probedAtMs <= AVAILABILITY_STALE_MS
    ) {
      fresh.push(entry)
    }
  }
  if (fresh.length === 0) {
    return 'unknown'
  }
  return fresh.some(entry => entry.up) ? 'up' : 'down'
}

/**
 * The pulse phase for one render: true for a second and a half, false for the
 * next. The caller owns the clock so the phase is one decision for the whole
 * line, and the alternation between renders is the verifying "thinking" cue.
 */
export function pulsePhaseFor(nowMs: number): boolean {
  return Math.floor(nowMs / 1500) % 2 === 0
}

/**
 * The whole availability table, or undefined when no record exists. For
 * consumers that judge a PROVIDER from its rungs rather than one alias at a
 * time.
 */
export function readAvailabilityTable(
  options?: { home?: string | undefined } | undefined,
): AvailabilityMap | undefined {
  const opts = { __proto__: null, ...options } as {
    home?: string | undefined
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(
      readFileSync(availabilityPath({ home: opts.home }), 'utf8'),
    )
  } catch {
    return undefined
  }
  return typeof parsed === 'object' && parsed !== null
    ? (parsed as AvailabilityMap)
    : undefined
}

/**
 * The availability of one ladder key (`provider:model`), or undefined when no
 * record exists for it. Read defensively: a malformed record is no record.
 */
export function readAvailability(
  key: string,
  options?:
    | { home?: string | undefined; nowMs?: number | undefined }
    | undefined,
): { entry: AvailabilityEntry; stale: boolean } | undefined {
  const opts = { __proto__: null, ...options } as {
    home?: string | undefined
    nowMs?: number | undefined
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(
      readFileSync(availabilityPath({ home: opts.home }), 'utf8'),
    )
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return undefined
  }
  const entry = (parsed as Record<string, unknown>)[key]
  if (typeof entry !== 'object' || entry === null) {
    return undefined
  }
  const record = entry as Record<string, unknown>
  if (typeof record['up'] !== 'boolean') {
    return undefined
  }
  const probedAtMs =
    typeof record['probedAtMs'] === 'number' ? record['probedAtMs'] : 0
  const nowMs = opts.nowMs ?? Date.now()
  return {
    entry: { probedAtMs, up: record['up'] },
    stale: nowMs - probedAtMs > AVAILABILITY_STALE_MS,
  }
}
