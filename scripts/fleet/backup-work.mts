#!/usr/bin/env node
/*
 * @file Push the current HEAD to a durable backup ref, so work leaves the
 *   machine without waiting for a clean gate.
 *
 *   The problem this solves: on a shared checkout local main carries every
 *   session's commits, so one session's lint debt gates another session's push.
 *   The work then lives on exactly one disk. A deleted checkout took an
 *   afternoon of real, reviewed commits with it, and every one of them had been
 *   committed - they simply had nowhere else to be.
 *
 *   The ref goes under `wip/`, which `.git-hooks/_shared/push-durable-ref.mts`
 *   recognizes: the pre-push hook then runs every SAFETY scan (secrets,
 *   signatures, commit-message hygiene) and skips the QUALITY bar (lint, format,
 *   types, dispatch drift). A backup that has to be green is a backup nobody can
 *   take at the moment it matters.
 *
 *   What lands there is UNTESTED by contract. Rebase or cherry-pick from it;
 *   never merge it as-is.
 *
 *   Usage:
 *     node scripts/fleet/backup-work.mts            # wip/<branch>-<short sha>
 *     node scripts/fleet/backup-work.mts --label x  # wip/x
 *     node scripts/fleet/backup-work.mts --dry-run  # print the ref, push nothing
 */

import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { durableBackupBranch } from '../../.git-hooks/_shared/push-durable-ref.mts'
import { gitSync } from './_shared/git-exec.mts'
import { isMainModule } from './_shared/is-main-module.mts'
import { runMain } from './_shared/run-main.mts'

import type { ScriptMeta } from './_shared/run-main.mts'

const logger = getDefaultLogger()

// A push runs the pre-push safety scans and then talks to the remote. Ten
// minutes is slack, not a target: a backup being killed by a clock is the one
// outcome this script cannot have.
const BACKUP_PUSH_TIMEOUT_MS = 600_000

/**
 * Read the value after `name` in argv, or undefined when the flag is absent.
 */
export function flagValue(
  argv: readonly string[],
  name: string,
): string | undefined {
  const i = argv.indexOf(name)
  return i === -1 ? undefined : argv[i + 1]
}

/**
 * The label to name the backup after: the caller's `--label`, else the current
 * branch plus the short sha.
 *
 * The sha is included so two backups of the same branch do not overwrite each
 * other. Losing the earlier snapshot to the later one is the exact failure this
 * script exists to prevent.
 */
export function resolveLabel(config: {
  readonly branch: string
  readonly label: string | undefined
  readonly sha: string
}): string {
  const cfg = { __proto__: null, ...config } as typeof config
  if (cfg.label) {
    return cfg.label
  }
  const branch = cfg.branch === 'HEAD' ? 'detached' : cfg.branch
  return `${branch}-${cfg.sha}`
}

function gitOut(args: readonly string[]): string {
  return String(gitSync([...args]).stdout ?? '').trim()
}

/* c8 ignore start - entrypoint glue; the pure helpers carry the coverage */
export function main(argv: readonly string[]): number {
  const branch = gitOut(['rev-parse', '--abbrev-ref', 'HEAD']) || 'HEAD'
  const sha = gitOut(['rev-parse', '--short', 'HEAD'])
  if (!sha) {
    logger.fail('backup-work: no commit to back up.')
    logger.group()
    logger.error('Where: this checkout has no HEAD.')
    logger.error('Fix:   commit something first; a backup pushes commits.')
    logger.groupEnd()
    return 1
  }
  const ref = durableBackupBranch(
    resolveLabel({ branch, label: flagValue(argv, '--label'), sha }),
  )
  if (argv.includes('--dry-run')) {
    logger.log(`would push HEAD (${sha}) to ${ref}`)
    return 0
  }
  // `HEAD:refs/heads/<ref>` names the full remote ref, which is what the gate
  // reads. A bare branch name would leave the namespace to git's resolution.
  const result = gitSync(['push', 'origin', `HEAD:refs/heads/${ref}`], {
    stdioString: true,
    // gitSync defaults to 30s, which a push cannot meet: the pre-push hook runs
    // its safety scans first and the network round-trip follows. At the default
    // the push was killed mid-flight and reported as a failure with no output,
    // which reads as a rejected backup rather than a timeout.
    timeout: BACKUP_PUSH_TIMEOUT_MS,
  })
  if (result.status !== 0) {
    logger.fail(`backup-work: push to ${ref} failed.`)
    logger.group()
    // Print what git and the hook actually said. Summarizing it as "a safety
    // finding" was a guess, and it sent the reader looking for a secret when the
    // real cause was the push itself.
    const detail =
      `${String(result.stdout ?? '')}${String(result.stderr ?? '')}`.trim()
    if (detail) {
      logger.error(detail)
    }
    logger.error(
      'A SAFETY finding blocks a backup too: a secret or an unsigned commit is a fact about the bytes.',
    )
    logger.groupEnd()
    return 1
  }
  logger.success(`backed up HEAD (${sha}) to ${ref}`)
  logger.group()
  logger.info('Untested by contract - rebase or cherry-pick, never merge.')
  logger.groupEnd()
  return 0
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'pushes HEAD to a durable wip/ backup ref, skipping the quality gates but not the safety scans',
  help: `Usage: node scripts/fleet/backup-work.mts [flags]

  --label <name>  name the ref wip/<name> instead of wip/<branch>-<sha>
  --dry-run       print the ref that would be pushed, push nothing`,
}

if (isMainModule(import.meta.url)) {
  runMain(() => main(process.argv.slice(2)), SCRIPT_META)
}
/* c8 ignore stop */
