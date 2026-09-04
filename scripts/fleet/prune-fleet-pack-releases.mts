#!/usr/bin/env node
/**
 * @file Prune the `fleet-pack-<sha>` GitHub Releases series. The fleet fetcher
 *   reads the pack from GHCR (`ghcr-fetch.mts`), so the Releases series it used
 *   to read is dead output that grows one entry per cascade. This deletes the
 *   old ones and keeps the newest few as a hand-inspection window. THE SAFETY
 *   IS THE MEMBER PIN, not the keep count. A tag any roster member resolves is
 *   never deletable, and every member's pin must be readable first, because an
 *   unread member is an unknown pin rather than no pin. Secondarily, a release
 *   GHCR has no copy of is held by default, since it is then the only copy of
 *   that pack; `--drop-unmirrored` sweeps those and the pin guard still
 *   outranks it. Scoped to the `fleet-pack-` tag prefix. A `v<semver>` release
 *   is a member's real published artifact and is never a candidate, so pointing
 *   this at a repo with a semver series deletes nothing. Usage: node
 *   scripts/fleet/prune-fleet-pack-releases.mts [--repo owner/name] [--keep N]
 *   [--dry-run] [--json].
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { parseArgs } from 'node:util'
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { sleep } from '@socketsecurity/lib-stable/promises/timers'

import {
  fleetReposPath,
  parseFleetRepos,
} from './check/member-ci-fires-on-push.mts'
import { REPO_ROOT } from './paths.mts'
import { runCapture } from './registry-infra/shared.mts'

import { ghcrContainerVersionsPath } from './github/ghcr-package.mts'
import { isMainModule } from './process/is-main-module.mts'
import { runMain } from './process/run-main.mts'

import type { ScriptMeta } from './process/run-main.mts'

const logger = getDefaultLogger()

export const DEFAULT_REPO = 'SocketDev/socket-wheelhouse'
// The GHCR package the fleet fetcher actually reads.
export const GHCR_PACKAGE = 'socket-wheelhouse/fleet-pack'
export const KEEP_DEFAULT = 5
export const TAG_PREFIX = 'fleet-pack-'
// Pace deletes so the shared token's secondary rate limit is not tripped.
export const PACE_MS = 400

export interface PrunePlan {
  /**
   * Releases to delete, oldest first.
   */
  readonly doomed: string[]
  /**
   * Kept because they are inside the newest-N window.
   */
  readonly kept: string[]
  /**
   * Kept because GHCR has no pack for them.
   */
  readonly missingFromGhcr: string[]
  /**
   * Kept because a roster member still pins them. Never deletable.
   */
  readonly pinned: string[]
}

export interface PlanPruneOptions {
  /**
   * Also delete releases GHCR has no copy of. The pin guard still applies, so
   * this widens the sweep to packs nothing reads rather than disabling safety.
   */
  readonly dropUnmirrored?: boolean | undefined
}

export interface FormatPlanOptions {
  readonly dryRun?: boolean | undefined
}

/**
 * Whether a release tag belongs to the pack series this script prunes.
 */
export function isPackTag(tag: string): boolean {
  return tag.startsWith(TAG_PREFIX) && tag.length > TAG_PREFIX.length
}

/**
 * Split pack releases into keep, delete, and hold-because-GHCR-lacks-it.
 *
 * `tags` arrives newest first, matching `gh release list`. Non-pack tags are
 * dropped before any of this, so a member's semver series cannot be planned for
 * deletion by an off-by-one in the window.
 */
export function planPrune(
  tags: readonly string[],
  ghcrTags: ReadonlySet<string>,
  pinnedTags: ReadonlySet<string>,
  keep: number,
  options?: PlanPruneOptions | undefined,
): PrunePlan {
  const opts = { __proto__: null, ...options } as PlanPruneOptions
  const dropUnmirrored = opts.dropUnmirrored === true
  const packTags = tags.filter(isPackTag)
  const window = Math.max(keep, 0)
  const kept = packTags.slice(0, window)
  const candidates = packTags.slice(window)
  const doomed: string[] = []
  const missingFromGhcr: string[] = []
  const pinned: string[] = []
  for (let i = 0, { length } = candidates; i < length; i += 1) {
    const tag = candidates[i]!
    // The pin guard outranks everything. A member resolving this tag must keep
    // finding it, whichever channel it resolves from.
    if (pinnedTags.has(tag)) {
      pinned.push(tag)
      continue
    }
    if (ghcrTags.has(tag)) {
      doomed.push(tag)
      continue
    }
    if (dropUnmirrored) {
      doomed.push(tag)
    } else {
      missingFromGhcr.push(tag)
    }
  }
  // Oldest first, so an interrupted run has removed the least useful entries.
  doomed.reverse()
  return { doomed, kept, missingFromGhcr, pinned }
}

/**
 * Pack tags roster members currently pin, read from sibling checkouts on disk.
 *
 * Returns the members it could NOT read alongside the pins, because an
 * unreadable member is an unknown pin. A caller must treat a non-empty
 * `unreadable` as a reason to stop rather than as zero pins.
 */
export function readMemberPins(siblingRoot: string): {
  pins: Set<string>
  read: string[]
  unreadable: string[]
} {
  const roster = parseFleetRepos(
    readFileSync(fleetReposPath(REPO_ROOT), 'utf8'),
  )
  const pins = new Set<string>()
  const read: string[] = []
  const unreadable: string[] = []
  for (const repo of roster) {
    const configPath = path.join(
      siblingRoot,
      repo.name,
      '.config',
      'repo',
      'socket-wheelhouse.json',
    )
    if (!existsSync(configPath)) {
      unreadable.push(repo.name)
      continue
    }
    try {
      const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as {
        bundle?: { ref?: unknown | undefined } | undefined
      }
      const ref = parsed.bundle?.ref
      if (typeof ref === 'string' && ref.length > 0) {
        pins.add(ref)
      }
      read.push(repo.name)
    } catch {
      unreadable.push(repo.name)
    }
  }
  return { pins, read, unreadable }
}

/**
 * Release tags in the repo, newest first.
 */
export async function listReleaseTags(repo: string): Promise<string[]> {
  const r = await runCapture(
    'gh',
    [
      'release',
      'list',
      '--repo',
      repo,
      '--limit',
      '500',
      '--json',
      'tagName',
      '--jq',
      '.[].tagName',
    ],
    REPO_ROOT,
  )
  if (r.code !== 0) {
    throw new Error(`gh release list failed for ${repo} (exit ${r.code})`)
  }
  return r.stdout.split(/\r?\n/).filter(Boolean)
}

/**
 * Every tag GHCR holds for the fleet pack package.
 */
export async function listGhcrTags(owner: string): Promise<Set<string>> {
  const r = await runCapture(
    'gh',
    [
      'api',
      '--paginate',
      ghcrContainerVersionsPath(owner, GHCR_PACKAGE),
      '--jq',
      '.[].metadata.container.tags[]',
    ],
    REPO_ROOT,
  )
  if (r.code !== 0) {
    throw new Error(
      `gh api could not read GHCR versions for ${GHCR_PACKAGE} (exit ${r.code})`,
    )
  }
  return new Set(r.stdout.split(/\r?\n/).filter(Boolean))
}

export async function deleteRelease(repo: string, tag: string): Promise<void> {
  const r = await runCapture(
    'gh',
    [
      'release',
      'delete',
      tag,
      '--repo',
      repo,
      '--yes',
      // The pack tag is the release's reason to exist, so it goes with it.
      '--cleanup-tag',
    ],
    REPO_ROOT,
  )
  if (r.code !== 0) {
    throw new Error(`gh release delete failed for ${tag} (exit ${r.code})`)
  }
}

export function formatPlan(
  plan: PrunePlan,
  options?: FormatPlanOptions | undefined,
): string {
  const opts = { __proto__: null, ...options } as FormatPlanOptions
  const verb = opts.dryRun === true ? 'would delete' : 'deleting'
  const lines = [
    `${verb} ${plan.doomed.length} fleet-pack release(s); keeping the newest ${plan.kept.length}.`,
  ]
  if (plan.pinned.length > 0) {
    lines.push(
      `held ${plan.pinned.length} release(s) a roster member still pins:`,
      ...plan.pinned.map(tag => `  ${tag}`),
    )
  }
  if (plan.missingFromGhcr.length > 0) {
    lines.push(
      `held ${plan.missingFromGhcr.length} release(s) whose pack is absent from GHCR.`,
      'Each is the only copy of that pack. Pass --drop-unmirrored to delete them',
      'anyway; the pin guard still applies.',
    )
  }
  return lines.join('\n')
}

export async function main(): Promise<number> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      'drop-unmirrored': { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      json: { type: 'boolean' },
      keep: { type: 'string' },
      repo: { type: 'string' },
      'sibling-root': { type: 'string' },
    },
    strict: false,
  })
  const repo =
    typeof values['repo'] === 'string' ? values['repo'] : DEFAULT_REPO
  const dryRun = values['dry-run'] === true
  const parsedKeep = Number(values['keep'])
  const keep =
    Number.isInteger(parsedKeep) && parsedKeep >= 0 ? parsedKeep : KEEP_DEFAULT
  const owner = repo.split('/')[0]!

  const siblingRoot =
    typeof values['sibling-root'] === 'string'
      ? values['sibling-root']
      : path.dirname(REPO_ROOT)
  const { pins, read, unreadable } = readMemberPins(siblingRoot)
  if (unreadable.length > 0) {
    // An unreadable member is an UNKNOWN pin, which is not the same as no pin.
    // Deleting on a partial read is how a member's pinned tag disappears.
    logger.fail(
      `Could not read the bundle pin for ${unreadable.length} roster member(s): ${unreadable.join(', ')}.`,
    )
    logger.error(
      'An unread member is an unknown pin, so pruning now could delete a tag one of them resolves.',
    )
    logger.error(
      'Fix: clone the missing member(s) beside this repo, or pass --sibling-root <dir> pointing at where they live.',
    )
    return 1
  }
  logger.log(`read the bundle pin from ${read.length} roster member(s).`)

  let plan: PrunePlan
  try {
    const { 0: tags, 1: ghcrTags } = await Promise.all([
      listReleaseTags(repo),
      listGhcrTags(owner),
    ])
    if (ghcrTags.size === 0) {
      logger.fail(
        `GHCR returned no tags for ${GHCR_PACKAGE}. Refusing to prune: with no registry copy confirmed, every release is potentially the only copy of its pack. Check that \`gh auth status\` has read:packages, then re-run.`,
      )
      return 1
    }
    plan = planPrune(tags, ghcrTags, pins, keep, {
      dropUnmirrored: values['drop-unmirrored'] === true,
    })
  } catch (e) {
    logger.fail(`Could not read the release or GHCR state: ${errorMessage(e)}`)
    return 1
  }

  if (values['json'] === true) {
    logger.log(JSON.stringify({ ...plan, dryRun, keep, repo }, undefined, 2))
    return 0
  }

  logger.log(formatPlan(plan, { dryRun }))
  if (dryRun || plan.doomed.length === 0) {
    return 0
  }

  let deleted = 0
  for (let i = 0, { length } = plan.doomed; i < length; i += 1) {
    const tag = plan.doomed[i]!
    try {
      await deleteRelease(repo, tag)
      deleted += 1
    } catch (e) {
      // Report and continue: one refusal must not strand the rest of the sweep.
      logger.warn(`could not delete ${tag}: ${errorMessage(e)}`)
    }
    if (i + 1 < length) {
      await sleep(PACE_MS)
    }
  }
  logger.success(
    `Deleted ${deleted} of ${plan.doomed.length} fleet-pack release(s) from ${repo}.`,
  )
  return deleted === plan.doomed.length ? 0 : 1
}

export const SCRIPT_META: ScriptMeta = {
  describe:
    'prunes the dead fleet-pack GitHub Releases series, keeping the newest few',
  help: `Usage: node scripts/fleet/prune-fleet-pack-releases.mts [flags]

  --repo owner/name    repo to prune (default ${DEFAULT_REPO})
  --keep N             keep the newest N pack releases (default ${KEEP_DEFAULT})
  --drop-unmirrored    also delete releases GHCR has no copy of
  --sibling-root <dir> where roster member checkouts live (default this repo's parent)
  --dry-run            report the plan without deleting
  --json               emit the plan as JSON

A tag any roster member pins is never deleted, and every member's pin must be
readable before anything is. By default a release GHCR has no copy of is held
too, since it is then the only copy of that pack. Only ${TAG_PREFIX}* tags are
candidates; a v<semver> release is never touched.`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
