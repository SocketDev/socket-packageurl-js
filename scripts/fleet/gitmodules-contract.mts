#!/usr/bin/env node
/**
 * @file Print the `.gitmodules` pin-comment contract, and audit this repo's
 *   entries against it. This exists because the contract was twice inferred
 *   from a sample of entries and twice inferred wrong: first that a bare label
 *   beside the dated line was stale duplication, then that both lines were
 *   required. Neither is true. One line is required and everything above it is
 *   annotation. Run it instead of reading `.gitmodules` and guessing: node
 *   scripts/fleet/gitmodules-contract.mts prints the contract node
 *   scripts/fleet/gitmodules-contract.mts --audit lists every entry Exit: 0 —
 *   printed, or audited with every entry satisfying the contract. 1 — `--audit`
 *   found an entry whose nearest comment does not match.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { isMainModule } from './process/is-main-module.mts'
import { runMain } from './process/run-main.mts'
import type { ScriptMeta } from './process/run-main.mts'
import {
  describePinContract,
  entriesMissingPinLabel,
  entrySatisfiesPinContract,
  parseGitmodulesEntries,
} from './git/modules-pin-contract.mts'
import { REPO_ROOT } from './paths.mts'

const SCRIPT_META: ScriptMeta = {
  describe: 'prints the .gitmodules pin-comment contract and audits entries',
  help: `Usage: node scripts/fleet/gitmodules-contract.mts [flags]

  --audit  list every submodule entry and whether it satisfies the contract`,
}

export function main(): number {
  const logger = getDefaultLogger()
  logger.log(describePinContract())
  if (!process.argv.includes('--audit')) {
    return 0
  }
  const gitmodulesPath = path.join(REPO_ROOT, '.gitmodules')
  if (!existsSync(gitmodulesPath)) {
    logger.log('')
    logger.success('No .gitmodules in this repo, so there is nothing to audit.')
    return 0
  }
  const text = readFileSync(gitmodulesPath, 'utf8')
  const entries = parseGitmodulesEntries(text)
  const missing = entriesMissingPinLabel(text)
  logger.log('')
  logger.log(`Audit of ${entries.length} entry(ies):`)
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const entry = entries[i]!
    const ok = entrySatisfiesPinContract(entry)
    logger.log(
      `  ${ok ? 'ok  ' : 'FAIL'}  ${entry.name}  (${entry.commentsAbove.length} comment line(s) above)`,
    )
  }
  if (missing.length === 0) {
    logger.log('')
    logger.success(
      'Every entry satisfies the contract. A differing comment-line COUNT is not a finding.',
    )
    return 0
  }
  logger.log('')
  logger.error(
    `${missing.length} entry(ies) have no matching comment on the line immediately above.`,
  )
  return 1
}

/* c8 ignore start - CLI entry, covered by the unit spec around main(). */
if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
/* c8 ignore stop */
