#!/usr/bin/env node
/**
 * @file Install a `origin: 'git'` external tool: clone at the pinned commit,
 *   prove it, then hand THAT to the tool's own installer.
 *   THE ORDER IS THE WHOLE POINT. Verify first, install second. Upstream's
 *   install script is run only after the tree it will read has been proven to
 *   be the pinned commit, and it is pointed at the local clone rather than the
 *   network - so whatever upstream's default branch is doing at that moment
 *   cannot reach the machine. Running `curl | bash` would invert this: execute
 *   first, find out what ran never.
 *   IT STILL RUNS THIRD-PARTY CODE. Pinning says WHICH code runs, not that the
 *   code is safe. The checkout is staged under the fleet's own state directory
 *   rather than the repo, and the tool's installer inherits the environment it
 *   needs and nothing invented for it.
 *   Usage: node scripts/fleet/external-tools/install-cloned.mts <tool>
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { safeDelete, safeMkdir } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { getSocketHomePath } from '../paths.mts'
import { cloneAtPinnedSha, installerEnv } from './clone-install.mts'
import { isMainModule } from '../process/is-main-module.mts'
import { runMain } from '../process/run-main.mts'

import type { ClonedToolSpec } from './clone-install.mts'
import type { ScriptMeta } from '../process/run-main.mts'

const logger = getDefaultLogger()

/**
 * Where a tool's own installer lives inside its checkout.
 */
export const INSTALLER_RELATIVE_PATH = 'install.sh'

export interface InstallClonedConfig {
  readonly name: string
  readonly spec: ClonedToolSpec
}

/**
 * Where verified checkouts live.
 *
 * DURABLE, not a tmpdir. The installed shim resolves the tool's entry point
 * through the source it was installed from, so the checkout IS the installed
 * artifact rather than scratch that has served its purpose. Deleting it after
 * a successful install leaves a shim pointing at nothing, which is exactly how
 * the first version of this broke.
 */
export function clonedToolsDir(home: string = getSocketHomePath()): string {
  return path.join(home, '_state', 'cloned-tools')
}

/**
 * Clone, verify, then run the tool's installer against the verified tree.
 *
 * The checkout is KEPT on success and removed on failure. A half-installed
 * tree left behind would be indistinguishable from a verified one on the next
 * run, and the verification is the only thing separating them.
 */
export async function installClonedTool(
  config: InstallClonedConfig,
): Promise<void> {
  const checkout = path.join(clonedToolsDir(), config.name)
  await safeMkdir(path.dirname(checkout), { recursive: true })
  let installed = false
  try {
    await cloneAtPinnedSha(config.spec, checkout)
    logger.success(
      `${config.name}: verified ${config.spec.ref} at ${config.spec.sha}`,
    )
    const installer = path.join(checkout, INSTALLER_RELATIVE_PATH)
    if (!existsSync(installer)) {
      throw new Error(
        `No installer in the pinned checkout for ${config.name}. Where: ${installer}. Saw a tree with no ${INSTALLER_RELATIVE_PATH}; wanted the script this shape installs through. Fix: confirm the upstream still installs that way at ${config.spec.ref}, and update INSTALLER_RELATIVE_PATH if it moved.`,
      )
    }
    // Pointed at the verified clone, so the installer's own `git clone` reads
    // the proven tree instead of reaching for upstream's default branch.
    await spawn('bash', [installer], {
      env: installerEnv(config.spec, checkout, process.env),
      stdio: 'inherit',
    })
    installed = true
  } finally {
    if (!installed) {
      await safeDelete(checkout)
    }
  }
}

export const SCRIPT_META: ScriptMeta = {
  describe:
    'installs a clone-shaped external tool at its pinned commit, verifying the sha before running the upstream installer',
  help: `Usage: node scripts/fleet/external-tools/install-cloned.mts <tool>

Clones the tool at the tag recorded in scripts/fleet/setup/external-tools.json,
checks HEAD against the recorded sha, and only then runs the tool's own
installer with its source pointed at that verified checkout.

The verification is the point: a tag can be moved upstream, a commit sha cannot.
A mismatch aborts before any third-party code runs.`,
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  runMain(async () => {
    logger.fail(
      'Pass a tool name. Where: install-cloned.mts. Saw no argument; wanted a tool with origin: git in external-tools.json.',
    )
    return 1
  }, SCRIPT_META)
}
/* c8 ignore stop */
