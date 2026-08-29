#!/usr/bin/env node
/**
 * @file Run the repo-owned setup steps discovered in `scripts/repo/setup/`.
 *   This is the `setup-all` arm of `discoverRepoSetup`: the full wizard
 *   (`scripts/fleet/setup/index.mts`) runs the same discovery after its fleet
 *   steps, but `pnpm setup-all` (the lighter chain) does NOT run the wizard —
 *   so without this step the repo-owned steps (pbcopy-handler,
 *   user-global-hooks, user-global-settings) would be silently absent from
 *   `setup-all`. Each step is spawned with `stdio: 'inherit'` so a step's own
 *   failures and operator prompts surface; this runner itself is silent on
 *   success and logs one line per failing step. Steps run in sorted order
 *   (see `discoverRepoSetup`). Usage: node scripts/fleet/setup/repo-steps.mts.
 */

import path from 'node:path'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { discoverRepoSetup } from '../_shared/repo-setup.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import { REPO_ROOT } from '../paths.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'

export function main(): number {
  const logger = getDefaultLogger()
  const steps = discoverRepoSetup(REPO_ROOT)
  if (steps.length === 0) {
    return 0
  }
  let exitCode = 0
  for (let i = 0, { length } = steps; i < length; i += 1) {
    const rel = steps[i]!
    const r = spawnSync(
      'node',
      ['--experimental-strip-types', path.join(REPO_ROOT, rel)],
      { cwd: REPO_ROOT, stdio: 'inherit' },
    )
    if (r.status !== 0) {
      // One line per failure — the step's own output (inherited stdout/stderr)
      // already carries the detail.
      logger.fail(
        `[setup:repo-steps] ${path.basename(rel)} exited ${r.status ?? 'signal'}.`,
      )
      exitCode = 1
    }
  }
  return exitCode
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'run the repo-owned setup steps in scripts/repo/setup/ (the setup-all arm of discoverRepoSetup)',
  help: 'Usage: node scripts/fleet/setup/repo-steps.mts',
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
