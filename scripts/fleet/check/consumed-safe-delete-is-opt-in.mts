#!/usr/bin/env node
/*
 * @file Assert the `safeDelete` THIS REPO RESOLVES keeps its cwd-and-above
 *   guard off by default. The lib spells the flag `force`, and the safe
 *   spelling is `opts.force === true`. A `opts.force !== false` spelling
 *   defaults the flag ON, so every caller that passes no options runs with the
 *   guard disabled and an absolute path anywhere on disk is deletable.
 *
 *   Why a second check, when socket-lib already gates this in its own repo:
 *   that one probes socket-lib's `dist/`, which is the copy socket-lib BUILDS.
 *   A fleet member resolves the copy it INSTALLS — a published version from the
 *   registry — and the two move independently. Fixing the source and pushing it
 *   does not change what any member runs until a release ships and the pin
 *   moves. Measured: `@socketsecurity/lib@6.7.0`, resolved here, carries
 *   `opts.force !== false` while the source had already been corrected. A
 *   source-side gate reports green for the whole fleet in exactly that window,
 *   which is the window that matters.
 *
 *   The assertion is the BEHAVIOR, never the source text. A grep for the
 *   spelling passes on a comment, breaks on a harmless refactor, and says
 *   nothing about what a caller actually gets. So this builds a real directory
 *   and requires the delete to refuse it.
 *
 *   The probe sits BESIDE the repo root, never under the OS temp dir. The lib
 *   auto-forces a target inside its allowed directories (temp dir, cacache, the
 *   Socket user dir), so a probe in a temp dir would be deleted by a correct
 *   build too and the check would pass for the wrong reason.
 *
 *   Cleanup uses node's own `rmSync`, never the function under test: a check
 *   must not depend on the thing it is measuring to tidy up after itself.
 *
 *   Report-only for now (`MODE`). The defect is in a PUBLISHED dependency, so
 *   no member can turn this green by editing its own tree — promoting it on day
 *   one would block every push in the fleet on a release that does not exist
 *   yet. Flip `MODE` to `'strict'` the moment a corrected
 *   `@socketsecurity/lib` is released and the pin moves, which is also when a
 *   red here would mean a real regression rather than a known gap.
 *
 *   Report-only is NOT the mitigation. A loud check does not stop a delete; it
 *   only makes the exposure visible. The mitigation is a corrected release, or
 *   a `patches/` entry correcting `force` in the consumed build until one
 *   ships. Detail: docs/agents.md/fleet/fix-forward-not-revert.md.
 *
 *   Exit codes: 0 — the guard is on by default, or a gap under report mode;
 *   1 — the guard is disabled under strict.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import { REPO_ROOT } from '../paths.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

// GATED OFF: the defect lives in a published dependency, so no member can clear
// it locally.
// TODO(lib@7.0.0): flip to 'strict' (exit 1) once a corrected release is
// pinned, which is when a red here means a real regression rather than a known
// gap.
const MODE: 'report' | 'strict' = 'report'

/**
 * Whether a no-options delete of `target` was refused AND left the tree alone.
 *
 * Both halves matter. A build that throws after deleting is still a build that
 * deleted, so the surviving directory is the property, not the throw.
 */
export async function refusesOutsideCwdDelete(
  target: string,
  options?: ProbeConsumedDeleteGuardOptions | undefined,
): Promise<boolean> {
  const { deleteFn = safeDelete } = {
    __proto__: null,
    ...options,
  } as ProbeConsumedDeleteGuardOptions
  let threw = false
  try {
    await deleteFn(target)
  } catch {
    threw = true
  }
  return threw && existsSync(target)
}

/**
 * Build a throwaway tree beside the repo root and ask the resolved lib to
 * delete it with no options. Returns true when the guard held.
 *
 * The caller owns nothing here: the directory is created and removed by this
 * function, so a regression can only ever cost this probe.
 */
export interface ProbeConsumedDeleteGuardOptions {
  /**
   * The delete under test. Injectable so a unit test measures a stand-in
   * instead of the consumed build's own implementation.
   */
  deleteFn?: ((filepath: string) => Promise<void>) | undefined
}

export async function probeConsumedDeleteGuard(
  root: string,
  options?: ProbeConsumedDeleteGuardOptions | undefined,
): Promise<boolean> {
  const { deleteFn = safeDelete } = {
    __proto__: null,
    ...options,
  } as ProbeConsumedDeleteGuardOptions
  const probe = path.join(root, '..', `safe-delete-probe-${process.pid}`)
  // Both cleanups use node's rmSync on purpose. safeDeleteSync IS the thing
  // under test here: routing cleanup through it would make the probe depend on
  // the behavior it measures, and once the guard is correct a no-force delete of
  // this path — outside the cwd by design — is refused, so the probe would leak.
  // oxlint-disable-next-line socket/prefer-safe-delete -- probes this api
  rmSync(probe, { force: true, recursive: true })
  mkdirSync(probe, { recursive: true })
  writeFileSync(path.join(probe, 'precious.txt'), 'keep')
  try {
    return await refusesOutsideCwdDelete(probe, { deleteFn })
  } finally {
    // oxlint-disable-next-line socket/prefer-safe-delete -- probes this api
    rmSync(probe, { force: true, recursive: true })
  }
}

export async function main(): Promise<void> {
  const isQuiet = process.argv.includes('--quiet')
  if (await probeConsumedDeleteGuard(REPO_ROOT)) {
    if (!isQuiet) {
      logger.log(
        '[consumed-safe-delete-is-opt-in] ok — the resolved safeDelete refuses a path outside the cwd',
      )
    }
    return
  }
  const isStrict = MODE === 'strict'
  const report = isStrict ? logger.fail : logger.warn
  report.call(
    logger,
    '[consumed-safe-delete-is-opt-in] the resolved safeDelete deleted a directory ' +
      'outside the cwd with no force flag' +
      (isStrict ? '.' : ' (report-only).'),
  )
  logger.group()
  logger.error(
    'Saw: a no-options safeDelete removed a probe directory beside the repo root. ' +
      'Wanted: a refusal, so that only an explicit `force: true` reaches cwd and above.',
  )
  logger.error(
    'Every safeDelete call in this repo currently runs with the guard disabled, ' +
      'so any target a caller computes is deletable — including a path built by ' +
      "walking '..' out of a fixture directory.",
  )
  logger.error(
    'Fix: ship a @socketsecurity/lib release whose safeDelete resolves `force` as ' +
      '`opts.force === true` and move this repo pin onto it. Until that release ' +
      'exists, add an `overrides:` entry pinning a corrected build.',
  )
  logger.groupEnd()
  if (isStrict) {
    process.exitCode = 1
  }
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'checks the resolved safeDelete keeps its cwd-and-above guard on by default',
  help: `Usage: node scripts/fleet/check/consumed-safe-delete-is-opt-in.mts [flags]

  --quiet  silent on clean`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
