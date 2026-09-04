#!/usr/bin/env node
/**
 * @file Fleet check - nothing reads the fleet pack out of a GitHub Release. The
 *   pack publishes to GHCR, so a `gh release download` in pack code reaches a
 *   channel that carries no pack and returns nothing. WHY THIS EXISTS AS A
 *   GATE. Moving the pack to GHCR left six readers behind on the old channel,
 *   and none of them failed loudly: a fetch that finds no asset looks like an
 *   empty result, so `fleet:status` lost its pinned SHA, a check passed
 *   vacuously, and the operator fetch broke, all while reporting success.
 *   Finding them took a hand sweep that undercounted twice, first at three then
 *   at five. A grep is not a gate, so this is the gate. THE RULE: a file that
 *   mentions the pack or its manifest must not invoke `gh release download`.
 *   Scoped to that one verb on purpose. Creating, uploading, editing, and
 *   deleting a release are different acts, and pruning the dead release series
 *   legitimately lists and deletes them. Every one of the six readers used
 *   `download`, so the narrow rule catches the whole class without an allowlist
 *   to maintain. The fix for a violation is never to re-point the download. It
 *   is to delegate to the dep-0 seed via `_shared/pack-fetcher.mts`, which owns
 *   how a pack is reached. Two implementations of the fetch is what let the
 *   readers drift in the first place. Usage: node
 *   scripts/fleet/check/pack-reads-are-registry-only.mts [--json] [--quiet].
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { REPO_ROOT } from '../paths.mts'
import {
  FETCHER_DIR,
  FETCHER_PAIR,
  pinnedBundleRef,
} from './member-fetcher-matches-pinned-pack.mts'
import { collectTrackedFiles } from '../fs/tracked-globs.mts'
import { isMainModule } from '../process/is-main-module.mts'
import { isJsonRequested, runMain } from '../process/run-main.mts'

import type { ScriptMeta } from '../process/run-main.mts'

const logger = getDefaultLogger()

/**
 * Tokens that mark a file as pack code. A file that names neither is talking
 * about some other release series and is none of this check's business.
 */
const PACK_TOKENS: readonly string[] = ['fleet-pack', 'release-bundle-manifest']

/**
 * The retired read. Matched as the `release` and `download` argv pair rather
 * than as one string, because these are spawn argument arrays, not a shell
 * line.
 */
const RELEASE_ARG = "'release',"
const DOWNLOAD_ARG = "'download',"

export interface PackReadFinding {
  readonly file: string
  readonly line: number
}

/**
 * Whether a file's text is pack code.
 */
export function mentionsPack(text: string): boolean {
  for (let i = 0, { length } = PACK_TOKENS; i < length; i += 1) {
    if (text.includes(PACK_TOKENS[i]!)) {
      return true
    }
  }
  return false
}

/**
 * Lines invoking the retired read.
 *
 * A comment line is skipped: this check's own prose, and the comments
 * explaining why callers delegate, both have to name the thing they forbid.
 */
export function findReleaseDownloads(text: string): number[] {
  const lines = text.split(/\r?\n/)
  const hits: number[] = []
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const trimmed = lines[i]!.trimStart()
    if (trimmed.startsWith('*') || trimmed.startsWith('//')) {
      continue
    }
    if (trimmed.startsWith(DOWNLOAD_ARG)) {
      // The verb sits on its own argv line, so look back for the subcommand.
      for (let j = i - 1; j >= 0 && j >= i - 3; j -= 1) {
        if (lines[j]!.trimStart().startsWith(RELEASE_ARG)) {
          hits.push(i + 1)
          break
        }
      }
    }
  }
  return hits
}

export interface PackReadScan {
  readonly filesScanned: number
  readonly findings: PackReadFinding[]
  // Files this check saw a violation in and deliberately left to
  // member-fetcher-matches-pinned-pack. Reported, never silent: a deferral
  // nobody prints is indistinguishable from a file that came back clean.
  readonly deferred: PackReadFinding[]
}

/**
 * Whether `file` is the dep-0 fetcher pair delivered BY the pinned pack.
 *
 * These two files have two gates pointed at them, and before this they could
 * contradict: member-fetcher-matches-pinned-pack requires the pair to match the
 * pinned pack's stamp byte for byte, while this check requires it not to read
 * the pack from a GitHub Release. A member whose pinned pack predates the
 * registry fix cannot satisfy both — correcting the read breaks the stamp, and
 * restoring the stamp brings the read back. Verified by swapping the pair and
 * running each check: each version passes exactly one.
 *
 * A member cannot fix the file at all, only re-pin. So the pair has ONE owner
 * on the member side, the check that can actually name the remedy, and this
 * check steps back. In the wheelhouse there is no `bundle.ref`, the pair is
 * generated from source that IS fixable, and the rule applies as normal.
 */
export function isPinnedFetcherFile(
  file: string,
  bundleRef: string | undefined,
): boolean {
  if (!bundleRef) {
    return false
  }
  const dir = normalizePath(FETCHER_DIR)
  return FETCHER_PAIR.some(name => file === `${dir}/${name}`)
}

export async function scanRepo(repoRoot: string): Promise<PackReadScan> {
  const tracked = await collectTrackedFiles(['**/*.mts', '**/*.mjs'], {
    cwd: repoRoot,
    dot: true,
  })
  const bundleRef = pinnedBundleRef(repoRoot)
  const deferred: PackReadFinding[] = []
  const findings: PackReadFinding[] = []
  let filesScanned = 0
  for (
    let i = 0, { length } = tracked.length ? tracked : [];
    i < length;
    i += 1
  ) {
    const file = normalizePath(tracked[i]!)
    let text: string
    try {
      text = readFileSync(path.join(repoRoot, file), 'utf8')
    } catch {
      continue
    }
    if (!mentionsPack(text)) {
      continue
    }
    filesScanned += 1
    const owned = isPinnedFetcherFile(file, bundleRef)
    for (const line of findReleaseDownloads(text)) {
      ;(owned ? deferred : findings).push({ file, line })
    }
  }
  return { deferred, filesScanned, findings }
}

export function formatFailure(scan: PackReadScan): string {
  return [
    `${scan.findings.length} location(s) read the fleet pack from a GitHub Release:`,
    '',
    ...scan.findings.map(finding => `  ${finding.file}:${finding.line}`),
    '',
    'Saw: a `gh release download` in code that names the pack.',
    'Wanted: the pack read from the registry it publishes to.',
    '',
    'Fix: delegate to the dep-0 seed via _shared/pack-fetcher.mts. Do NOT re-point',
    'the download: a second implementation of the fetch is what let six readers',
    'drift onto a dead channel, each returning nothing while reporting success.',
  ].join('\n')
}

/**
 * Say which files this check handed to member-fetcher-matches-pinned-pack, and
 * what clears them. Warned rather than failed: the member cannot edit a
 * pack-delivered file, so failing here would demand a fix nobody in this repo
 * can make.
 */
export function reportDeferred(scan: PackReadScan): void {
  if (!scan.deferred.length) {
    return
  }
  logger.warn(
    `${scan.deferred.length} location(s) in the pinned fetcher pair read the pack from a GitHub Release:`,
  )
  for (let i = 0, { length } = scan.deferred; i < length; i += 1) {
    const finding = scan.deferred[i]!
    logger.warn(`  ${finding.file}:${finding.line}`)
  }
  logger.warn(
    '  These ship WITH the pinned pack, so this repo cannot edit them — the two',
  )
  logger.warn(
    "  requirements would contradict, one demanding the pack's bytes and the other",
  )
  logger.warn(
    '  a different read. member-fetcher-matches-pinned-pack owns them; re-pin to a',
  )
  logger.warn('  pack whose fetcher reads from the registry and both clear.')
}

export async function main(): Promise<number> {
  const scan = await scanRepo(REPO_ROOT)
  if (isJsonRequested(process.argv)) {
    logger.log(JSON.stringify(scan, undefined, 2))
    return scan.findings.length === 0 ? 0 : 1
  }
  // Printed before the verdict either way. A file this check stepped back from
  // is still gated, by member-fetcher-matches-pinned-pack, and saying so is
  // what keeps the hand-off from reading as a clean scan.
  reportDeferred(scan)
  if (scan.findings.length > 0) {
    logger.fail(formatFailure(scan))
    return 1
  }
  if (!process.argv.includes('--quiet')) {
    logger.success(
      `No GitHub-Release pack reads across ${scan.filesScanned} pack-related file(s).`,
    )
  }
  return 0
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'checks nothing reads the fleet pack out of a GitHub Release instead of the registry',
  help: `Usage: node scripts/fleet/check/pack-reads-are-registry-only.mts [flags]

  --json   emit the measurement as JSON instead of prose
  --quiet  suppress the pass message

Scoped to \`gh release download\` in code that names the pack. Creating,
uploading, and deleting a release are different acts, so pruning the dead release
series is unaffected.`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
