#!/usr/bin/env node
/*
 * @file Graft the 1Password extension from the operator's main Chrome
 *   profile into a registered controlled-browser profile (default: the
 *   shared MCP profile). Work-managed Chrome blocks Web Store installs into
 *   fresh profiles, so the extension is copied registration-and-all from the
 *   profile that already has it — a same-machine graft keeps the HMACs
 *   valid and the desktop-app bridge working. Every precondition is checked
 *   and reported; `--describe` prints the checks without copying.
 */

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import process from 'node:process'

import { isMainModule } from './_shared/is-main-module.mts'
import { ensureOnePasswordGraft } from './_shared/browser-control/one-password.mts'
import { profileById, PROFILES } from './_shared/browser-control/profiles.mts'
import { isJsonRequested, runMain } from './_shared/run-main.mts'

import type { ScriptMeta } from './_shared/run-main.mts'

const logger = getDefaultLogger()

const SCRIPT_META: ScriptMeta = {
  describe:
    'Graft 1Password from your main Chrome profile into a controlled-browser profile (default: the shared MCP profile).',
  help: [
    'Usage: node scripts/fleet/browser-control-graft.mts [--profile <id>] [--dry-run] [--json]',
    '',
    `  --profile <id>  which registered profile to graft into (default: mcpShared; known: ${Object.keys(PROFILES).join(', ')})`,
    '  --dry-run       run the checks without copying anything',
    '  --json          print the check results as JSON',
  ].join('\n'),
}

/**
 * The `--profile <id>` value on argv, defaulting to the shared MCP profile.
 * Pure — exported for tests.
 */
export function profileIdFromArgv(argv: readonly string[]): string {
  const index = argv.indexOf('--profile')
  if (index === -1) {
    return 'mcpShared'
  }
  const value = argv[index + 1]
  if (value === undefined) {
    throw new Error(
      `--profile needs a value — known: ${Object.keys(PROFILES).join(', ')}`,
    )
  }
  return value
}

export async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const profile = profileById(profileIdFromArgv(argv))
  const result = await ensureOnePasswordGraft(profile.dir, {
    dryRun: argv.includes('--dry-run'),
  })
  if (isJsonRequested(argv)) {
    logger.log(JSON.stringify(result, undefined, 2))
  } else {
    const glyph = { fail: '✗', pass: '✓', warn: '!' } as const
    for (const c of result.checks) {
      logger.log(`${glyph[c.status]} ${c.name}: ${c.detail}`)
    }
  }
  const failed = result.checks.some(c => c.status === 'fail')
  if (failed) {
    logger.error('1Password graft failed — see the ✗ checks above.')
    return 1
  }
  if (result.skipped) {
    logger.log('Graft skipped (see the checks above).')
    return 0
  }
  return 0
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
