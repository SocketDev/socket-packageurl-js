/*
 * @file Code-is-law gate for the Local-CI gh-aw-lock boundary
 *   (`local-ci-skip-locks.mts`). Local CI's `@actions/workflow-parser` crashes
 *   on a gh-aw compiled `*.lock.yml` (it returns no `.jobs`, so Local CI aborts
 *   with `No jobs found`). The wrapper script turns that into an informative
 *   error / skip. This check keeps the boundary honest:
 *
 *   1. The wrapper exists and exports its guard surface (`isLockYmlTarget`,
 *      `extractWorkflowTarget`, `listLockYmls`, `main`).
 *   2. The wrapper actually guards a `.lock.yml` `--workflow` target — a
 *      `.lock.yml` path must classify as a lock target. Exit 0 — boundary
 *      intact; 1 — drift. Wiring the canonical `ci:local` command to route
 *      through the wrapper is tracked separately (it touches the
 *      script-synthesis manifest, which is mid-rename); this gate stands on its
 *      own so the wrapper can't silently rot.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

const logger = getDefaultLogger()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const WRAPPER_PATH = path.join(__dirname, '..', 'local-ci-skip-locks.mts')

const REQUIRED_EXPORTS = [
  'extractWorkflowTarget',
  'isLockYmlTarget',
  'listLockYmls',
  'main',
]

export async function checkLocalCiSkipLocksIsGuarded(): Promise<number> {
  if (!existsSync(WRAPPER_PATH)) {
    logger.error('Local-CI lock-skip wrapper is missing.')
    logger.group()
    logger.info(`Where: ${WRAPPER_PATH}`)
    logger.info('Saw: no file at that path')
    logger.info(
      'Fix: restore scripts/fleet/local-ci-skip-locks.mts (re-cascade from ' +
        'the wheelhouse template).',
    )
    logger.groupEnd()
    return 1
  }

  const mod = (await import(WRAPPER_PATH)) as Record<string, unknown>
  const missing = REQUIRED_EXPORTS.filter(
    name => typeof mod[name] !== 'function',
  )
  if (missing.length) {
    logger.error('Local-CI lock-skip wrapper is missing required exports.')
    logger.group()
    logger.info(`Where: ${WRAPPER_PATH}`)
    logger.info(`Saw: absent ${missing.join(', ')}`)
    logger.info("Fix: keep the wrapper's exported guard surface intact.")
    logger.groupEnd()
    return 1
  }

  const isLockYmlTarget = mod['isLockYmlTarget'] as (v: unknown) => boolean
  if (!isLockYmlTarget('weekly-update.lock.yml')) {
    logger.error(
      'Local-CI lock-skip wrapper no longer recognizes a .lock.yml target.',
    )
    logger.group()
    logger.info(`Where: ${WRAPPER_PATH} isLockYmlTarget()`)
    logger.info("Saw: isLockYmlTarget('weekly-update.lock.yml') === false")
    logger.info(
      'Fix: the wrapper must classify a *.lock.yml path as a lock target ' +
        'so it errors/skips instead of crashing Local CI.',
    )
    logger.groupEnd()
    return 1
  }

  logger.success('Local-CI gh-aw-lock boundary is intact.')
  return 0
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (process.argv[1]?.endsWith('local-ci-skip-locks-is-guarded.mts')) {
  void (async () => {
    process.exitCode = await checkLocalCiSkipLocksIsGuarded()
  })()
}
/* c8 ignore stop */
