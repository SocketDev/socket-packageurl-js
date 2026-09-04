/**
 * @file Composite Swift auto-fix lane: run `lint-swift.mts --fix`
 *   (swiftlint's machine-applicable autofixes) then `fmt-swift.mts`
 *   (swift-format) — autofix first, formatter owns final wrapping, the same
 *   ordering `fix-go.mts` uses for golangci-lint/gofmt. Mode:
 *   node scripts/fleet/fix-swift.mts   # swiftlint --fix, then swift-format
 *   Both steps run even when the first fails, so a swiftlint miss never
 *   blocks swift-format from still formatting the tree; the exit code
 *   aggregates non-zero if either step failed. Its parts are `lint-swift.mts`
 *   and `fmt-swift.mts`.
 */

// prefer-async-spawn: sync-required — sequential CLI gates, exit-code
// aggregation.
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { isMainModule } from './process/is-main-module.mts'
import { runMain } from './process/run-main.mts'
import type { ScriptMeta } from './process/run-main.mts'
import { REPO_ROOT } from './paths.mts'

const logger = getDefaultLogger()

/**
 * The ordered `node <script> [flags]` argv for each step of the composite fix
 * lane. Pure + exported so a test asserts the order (lint --fix before fmt)
 * and the exact flags without spawning either script.
 */
export function planFixSwiftSteps(): Array<{ args: string[]; label: string }> {
  return [
    {
      args: ['scripts/fleet/lint-swift.mts', '--fix'],
      label: 'lint-swift --fix',
    },
    {
      args: ['scripts/fleet/fmt-swift.mts'],
      label: 'fmt-swift',
    },
  ]
}

export function main(): void {
  const steps = planFixSwiftSteps()
  let failed = false
  for (let i = 0, { length } = steps; i < length; i += 1) {
    const step = steps[i]!
    logger.info(`fix-swift: ${step.label} (node ${step.args.join(' ')})`)
    const result = spawnSync('node', step.args, {
      cwd: REPO_ROOT,
      stdio: 'inherit',
    })
    if (result.status !== 0) {
      failed = true
    }
  }
  if (failed) {
    logger.fail(
      'fix-swift: lint-swift --fix or fmt-swift failed. Fix: resolve the ' +
        'swiftlint/swift-format output above, then rerun ' +
        'node scripts/fleet/fix-swift.mts.',
    )
    process.exitCode = 1
    return
  }
  logger.info('fix-swift: clean.')
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'runs the Swift auto-fix pair: swiftlint --fix, then swift-format, in that order',
  help: `Usage: node scripts/fleet/fix-swift.mts

  Runs node scripts/fleet/lint-swift.mts --fix, then node scripts/fleet/fmt-swift.mts.
  swiftlint's autofixes go first so swift-format owns the final wrapping.`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
