#!/usr/bin/env node
/**
 * @file `setup:fireconnect` — install FireConnect at its pinned commit.
 *   WHY A SCRIPT RATHER THAN THE DOCUMENTED ONE-LINER. Upstream installs with
 *   `curl … | bash`, which executes before anyone can see what arrived and
 *   pins nothing: two runs a day apart install different code and neither can
 *   say which. This clones the recorded tag, proves HEAD is the recorded
 *   commit, and only then runs upstream's own installer against that verified
 *   tree - so the order is verify, then execute.
 *   WHAT IT IS FOR. `fireconnect login` does browser auth and populates
 *   `FIREWORKS_API_KEY`, which the offload gauges already read, so this clears
 *   the Fireworks credential without either side handling a raw key.
 *   INSTALLING ROUTES NOTHING. `fireconnect <harness> on` rewrites that
 *   harness's model routing persistently, and Claude Code is a supported
 *   harness. That is a separate deliberate command; this script never runs it.
 *   Usage: pnpm run setup:fireconnect.
 */

import { readFileSync } from 'node:fs'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'

import { installClonedTool } from '../external-tools/install-cloned.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { resolveManifestPaths } from '../external-tools/_shared.mts'
import { runMain } from '../_shared/run-main.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

export const TOOL_NAME = 'fireconnect'

/**
 * The pinned record for a tool, from whichever shipped manifest declares it.
 *
 * Reads the manifests rather than importing the JSON so a member repo's own
 * manifest is honoured the same as the fleet's, which is the whole reason
 * there is a list of them.
 */
export function readPinnedTool(
  name: string,
): Record<string, unknown> | undefined {
  const manifests = resolveManifestPaths()
  for (let i = 0, { length } = manifests; i < length; i += 1) {
    const parsed = JSON.parse(readFileSync(manifests[i]!, 'utf8')) as {
      // oxlint-disable-next-line socket/prefer-refined-record -- JSON doc
      tools?: Record<string, Record<string, unknown>> | undefined
    }
    const tool = parsed.tools?.[name]
    if (tool) {
      return tool
    }
  }
  return undefined
}

export async function main(): Promise<number> {
  let tool: Record<string, unknown> | undefined
  try {
    tool = readPinnedTool(TOOL_NAME)
  } catch (e) {
    logger.fail(
      `Could not read the ${TOOL_NAME} pin: ${errorMessage(e)}. Where: the external-tools manifests. Fix: restore its entry, which must carry ref, sha, and sourceEnvVar.`,
    )
    return 1
  }
  const ref = tool?.['ref']
  const sha = tool?.['sha']
  const sourceEnvVar = tool?.['sourceEnvVar']
  const repository = tool?.['repository']
  if (
    typeof ref !== 'string' ||
    typeof sha !== 'string' ||
    typeof sourceEnvVar !== 'string' ||
    typeof repository !== 'string'
  ) {
    logger.fail(
      `The ${TOOL_NAME} entry is not clone-shaped. Where: scripts/fleet/setup/external-tools.json. Saw a record missing one of ref/sha/sourceEnvVar/repository; wanted all four. Fix: a release: 'clone' tool pins by commit, so none of them is optional.`,
    )
    return 1
  }

  try {
    await installClonedTool({
      name: TOOL_NAME,
      spec: {
        ref,
        // `github:owner/name` in the manifest, a clonable URL here.
        repository: repository.startsWith('github:')
          ? `https://github.com/${repository.slice('github:'.length)}.git`
          : repository,
        sha,
        sourceEnvVar,
      },
    })
  } catch (e) {
    logger.fail(`setup:${TOOL_NAME} — ${errorMessage(e)}`)
    return 1
  }

  logger.success(
    `setup:${TOOL_NAME} — installed at ${ref}. Run \`fireconnect login\` to authenticate; it populates FIREWORKS_API_KEY for the offload gauges.`,
  )
  return 0
}

export const SCRIPT_META: ScriptMeta = {
  describe:
    'installs FireConnect at the commit pinned in external-tools.json, verifying the sha before running its installer',
  help: `Usage: pnpm run setup:fireconnect

Clones fireconnect at its pinned tag, checks HEAD against the recorded commit,
then runs upstream's install.sh with FIRECONNECT_SOURCE pointed at that verified
checkout - so upstream's default branch never reaches this machine.

Installing routes nothing. \`fireconnect <harness> on\` rewrites that harness's
model routing persistently and is a separate deliberate command.`,
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
/* c8 ignore stop */
