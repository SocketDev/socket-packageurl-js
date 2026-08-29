#!/usr/bin/env node
/*
 * @file Sync the fleet inline-action port pins to their upstreams' latest
 *   releases. Each entry in COMPOSITE_ACTION_PORTS (action-port-map.mts)
 *   names the upstream + the tag the port was last reviewed against
 *   (`portedAt`). This script fetches each upstream's latest release tag via
 *   `gh api` + reports drift: which ports are behind their upstream, which are
 *   current, and which use a branch pin (no tag to compare). Run weekly via
 *   weekly-update.yml; a port behind its upstream is a drift-watch defect.
 *
 *   Usage: node scripts/fleet/sync-inline-action-pins.mts [--strict]
 *   --strict  exit 1 when any port is behind its upstream (for the gate).
 */

import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { isMainModule } from './_shared/is-main-module.mts'
import { runMain } from './_shared/run-main.mts'
import {
  COMPOSITE_ACTION_PORTS,
  splitSlug,
} from './_shared/action-port-map.mts'

import type { CompositePort } from './_shared/action-port-map.mts'
import type { ScriptMeta } from './_shared/run-main.mts'

const logger = getDefaultLogger()

/**
 * Fetch the latest release tag for an `<owner>/<repo>` upstream via `gh api`.
 * Returns undefined when the upstream has no releases or the fetch fails.
 */
export function fetchLatestReleaseTag(upstream: string): string | undefined {
  const res = spawnSync(
    'gh',
    ['api', `repos/${upstream}/releases/latest`, '--jq', '.tag_name'],
    { stdio: ['ignore', 'pipe', 'pipe'], stdioString: true },
  )
  if (res.status !== 0) {
    return undefined
  }
  const tag = typeof res.stdout === 'string' ? res.stdout.trim() : ''
  return tag || undefined
}

/**
 * Classify a port's pin against its upstream's latest release:
 * - `branch` - the port uses a branch pin. portedSha is set, so there is no
 * tag to compare; reported as current. Branch pins are reviewed on a cadence.
 * - `current` - portedAt equals the latest release tag.
 * - `behind` - the upstream has a newer release than portedAt.
 * - `unknown` - the upstream has no releases, or the fetch failed.
 */
export function classifyPortPin(
  port: CompositePort,
  latest: string | undefined,
): 'branch' | 'current' | 'behind' | 'unknown' {
  if (port.portedSha !== undefined) {
    return 'branch'
  }
  if (latest === undefined) {
    return 'unknown'
  }
  if (port.portedAt === latest) {
    return 'current'
  }
  return 'behind'
}

export async function main(): Promise<number> {
  const strict = process.argv.includes('--strict')
  const entries = Object.entries(COMPOSITE_ACTION_PORTS)
  const behind: string[] = []
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const [composite, ports] = entries[i]!
    for (let j = 0, portCount = ports.length; j < portCount; j += 1) {
      const port = ports[j]!
      const slug = splitSlug(port.upstream)
      if (!slug) {
        continue
      }
      const latest = fetchLatestReleaseTag(port.upstream)
      const verdict = classifyPortPin(port, latest)
      const label = `${composite} -> ${port.upstream}`
      if (verdict === 'branch') {
        logger.log(
          `${label}: branch pin (${port.portedAt} @ ${port.portedSha ?? 'unknown'}) - reviewed on cadence.`,
        )
      } else if (verdict === 'current') {
        logger.log(`${label}: current at ${port.portedAt}.`)
      } else if (verdict === 'behind') {
        logger.fail(
          `${label}: BEHIND - ported at ${port.portedAt}, upstream latest is ${latest}. Re-review the port against the upstream diff + advance portedAt.`,
        )
        behind.push(label)
      } else {
        logger.warn(
          `${label}: unknown - no releases found for ${port.upstream} (or gh api failed).`,
        )
      }
    }
  }
  if (behind.length > 0) {
    logger.error('')
    logger.error(`${behind.length} port(s) behind their upstream.`)
    if (strict) {
      return 1
    }
  }
  return 0
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'reports which fleet inline-action port pins are behind their upstreams latest releases',
  help: `Usage: node scripts/fleet/sync-inline-action-pins.mts [--strict]

  --strict  exit 1 when any port is behind its upstream (for the gate)

Reads COMPOSITE_ACTION_PORTS + fetches each upstream's latest release tag via
gh api. A port behind its upstream is a drift-watch defect; re-review the port
against the upstream diff + advance portedAt in action-port-map.mts.`,
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
/* c8 ignore stop */
