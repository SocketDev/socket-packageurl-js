#!/usr/bin/env node
/**
 * @file Populate the `private_repo_roster` table in the Socket state DB
 *   (`~/.socket/_state/wheelhouse.sqlite`) for the fleet's owners.
 *   THE SCHEMA NEEDS NO SETUP. `openSocketState` runs CREATE TABLE IF NOT
 *   EXISTS on first open, so the tables always exist. What a fresh machine
 *   lacks is the DATA: the roster rows come from `gh repo list` per owner, and
 *   until they are written every visibility lookup fails closed.
 *   `preflight` calls setupRosterDb directly, so this script is the manual
 *   entry point for the same work: seeding a machine whose roster table has
 *   never been written, and refreshing it afterwards.
 *   Usage:
 *   pnpm run setup:roster-db           # refresh stale entries only
 *   pnpm run setup:roster-db --force   # force refresh all owners
 *   pnpm run setup:roster-db --stats   # show roster stats without refresh.
 */

import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import type { ScriptMeta } from '../_shared/run-main.mts'
import {
  forceRefreshOwnerRoster,
  getRosterStats,
  setupRosterDb,
} from '../_shared/repo-visibility.mts'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

const logger = getDefaultLogger()

const SCRIPT_META: ScriptMeta = {
  describe: 'Prime the private repo roster for fleet owners',
  help: `Usage:
  pnpm run setup:roster-db           # refresh stale entries only
  pnpm run setup:roster-db --force   # force refresh all owners
  pnpm run setup:roster-db --stats   # show roster stats without refresh`,
}

/**
 * The owners whose rosters this script seeds. One entry today, read as a list
 * so adding an owner is a data change rather than a control-flow one.
 */
const FLEET_OWNERS: readonly string[] = ['SocketDev']

/**
 * Which mode the argv asks for. Pure over the argument list, so the mode
 * table is testable without running any of the three modes.
 */
export function rosterDbMode(
  argv: readonly string[],
): 'force' | 'refresh' | 'stats' {
  // `--stats` wins: it is the read-only mode, and an operator who passed both
  // meant to look before refreshing.
  if (argv.includes('--stats')) {
    return 'stats'
  }
  return argv.includes('--force') ? 'force' : 'refresh'
}

/**
 * Report each owner's roster row: how many private repos it holds and how
 * stale it is. Reads the state DB only, so it never touches the network.
 */
export function reportRosterStats(): void {
  const stats = getRosterStats()
  logger.group('Roster stats:')
  for (const owner of stats.owners) {
    const ageMin = Math.round(owner.ageMs / 60_000)
    const freshLabel = owner.fresh ? 'fresh' : 'STALE'
    logger.substep(
      `${owner.owner}: ${owner.privateCount} private repos, ` +
        `age ${ageMin}m (${freshLabel})`,
    )
  }
  if (stats.owners.length === 0) {
    logger.substep('(no owners in roster)')
  }
  logger.groupEnd()
}

/**
 * Seed or refresh the roster, or report its stats. `--stats` reports without
 * touching the network; `--force` refreshes every fleet owner.
 */
export async function setupRosterDbCli(
  options?: { argv?: readonly string[] | undefined } | undefined,
): Promise<void> {
  const { argv = process.argv.slice(2) } = {
    __proto__: null,
    ...options,
  } as NonNullable<typeof options>
  const mode = rosterDbMode(argv)

  if (mode === 'stats') {
    reportRosterStats()
    return
  }

  if (mode === 'force') {
    logger.group('Force-refreshing roster for all fleet owners…')
    for (let i = 0, { length } = FLEET_OWNERS; i < length; i += 1) {
      const owner = FLEET_OWNERS[i]!
      const ok = await forceRefreshOwnerRoster(owner)
      logger.substep(
        ok ? `${owner}: refreshed` : `${owner}: FAILED (check gh auth)`,
      )
    }
    logger.groupEnd()
    reportRosterStats()
    return
  }

  logger.group('Priming roster (refreshing stale entries)…')
  const result = await setupRosterDb()

  if (result.refreshed.length > 0) {
    logger.substep(`Refreshed: ${result.refreshed.join(', ')}`)
  }
  if (result.failed.length > 0) {
    logger.substep(`Failed: ${result.failed.join(', ')}`)
  }
  if (result.refreshed.length === 0 && result.failed.length === 0) {
    logger.substep('All rosters already fresh.')
  }
  logger.groupEnd()

  reportRosterStats()

  if (!result.success) {
    process.exitCode = 1
  }
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  void runMain(setupRosterDbCli, SCRIPT_META)
}
/* c8 ignore stop */
