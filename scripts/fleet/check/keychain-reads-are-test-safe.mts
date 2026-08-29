// Fleet check — no code path reads the OS keychain without a test escape.
//
// A keychain read shows an OS auth prompt. That is fine when a human asked for
// something; it is not fine on two paths that recur:
//
//   1. A test runner. The prompt blocks, the test times out, and it fails on a
//      CORRECTLY configured machine - measuring the machine rather than the
//      code. It also trains an operator to click through prompts.
//   2. A statusline render, which happens constantly. Reading there asks for a
//      password over and over for a number nobody requested.
//
// So `readSecret` has exactly one sanctioned caller: `readCredential` in
// `_shared/provider-credentials.mts`, which short-circuits under a test runner
// before it reaches the keychain. Any other caller is a path that will prompt.
//
// Exit codes: 0 — every keychain read goes through the guarded helper; 1 — at
// least one does not.
//
// Usage: node scripts/fleet/check/keychain-reads-are-test-safe.mts [--quiet]

import { readFileSync } from 'node:fs'
import process from 'node:process'

import { globSync } from '@socketsecurity/lib-stable/globs/match'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import { REPO_ROOT } from '../paths.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

/**
 * The one module allowed to reach the keychain.
 */
export const SANCTIONED_READER =
  'scripts/fleet/_shared/provider-credentials.mts'

/**
 * What a keychain read looks like in source.
 */
export const KEYCHAIN_READ = 'readSecret('

/**
 * The escape a sanctioned reader must carry.
 */
export const TEST_ESCAPE = 'isUnderTest('

/**
 * This checker's own path, which it must not flag.
 */
export const SELF_PATH = 'scripts/fleet/check/keychain-reads-are-test-safe.mts'

export interface KeychainFinding {
  readonly file: string
  readonly reason: string
}

/**
 * Every file that reads the keychain outside the sanctioned helper.
 */
export function findKeychainReads(
  files: readonly string[],
  read: (file: string) => string,
): KeychainFinding[] {
  const findings: KeychainFinding[] = []
  for (let i = 0, { length } = files; i < length; i += 1) {
    const file = files[i]!
    const normalized = normalizePath(file)
    // This checker NAMES the pattern it hunts, so scanning itself finds a
    // match every time. Excluded by path rather than by some cleverer pattern,
    // because a scanner that cannot be written down plainly is worse than one
    // with a named exception.
    if (normalized.endsWith(SELF_PATH)) {
      continue
    }
    const text = read(file)
    if (!text.includes(KEYCHAIN_READ)) {
      continue
    }
    if (!normalized.endsWith(SANCTIONED_READER)) {
      findings.push({
        file: normalized,
        reason: `reads the keychain directly. Saw ${KEYCHAIN_READ} outside ${SANCTIONED_READER}; wanted readCredential(). Fix: route it through readCredential, which short-circuits under a test runner so a prompt never blocks a suite.`,
      })
      continue
    }
    if (!text.includes(TEST_ESCAPE)) {
      findings.push({
        file: normalized,
        reason: `is the sanctioned reader but lost its test escape. Saw no ${TEST_ESCAPE} guard; wanted one before the keychain read. Fix: restore it - without it every unit test that resolves a credential blocks on an OS prompt.`,
      })
    }
  }
  return findings
}

export async function main(): Promise<number> {
  const quiet = process.argv.includes('--quiet')
  const files = globSync(
    ['scripts/fleet/**/*.mts', 'template/base/scripts/fleet/**/*.mts'],
    {
      absolute: true,
      cwd: REPO_ROOT,
    },
  )
  const findings = findKeychainReads(files, file => readFileSync(file, 'utf8'))
  if (findings.length > 0) {
    for (const finding of findings) {
      logger.fail(`${finding.file}: ${finding.reason}`)
    }
    return 1
  }
  if (!quiet) {
    logger.success(
      `Every keychain read goes through ${SANCTIONED_READER}, which is test-safe.`,
    )
  }
  return 0
}

export const SCRIPT_META: ScriptMeta = {
  describe:
    'asserts the OS keychain is only read through the helper that short-circuits under a test runner',
  help: `Usage: node scripts/fleet/check/keychain-reads-are-test-safe.mts [--quiet]

  --quiet   report only failures

A keychain read shows an OS auth prompt. Under a test runner that blocks, times
out, and fails on a correctly configured machine. On a statusline it asks for a
password on every render. ${SANCTIONED_READER} is the one caller, and it checks
${TEST_ESCAPE} before reaching the keychain.`,
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
/* c8 ignore stop */
