/**
 * @file Owning linter for a repo's first-party Swift: run `swiftlint` for
 *   every Swift target dir in the tree (an Xcode project/workspace or a Swift
 *   package), skipping vendored/generated code. swiftlint discovers its own
 *   `.swiftlint.yml` by walking up from the target dir it is invoked in, so no
 *   `--config` flag is needed here. Modes:
 *   node scripts/fleet/lint-swift.mts         # verify (CI / pre-push)
 *   node scripts/fleet/lint-swift.mts --fix   # apply swiftlint's autofixes
 *   Target discovery is shared with `fmt-swift.mts` via
 *   `_shared/swift-targets.mts`. A machine with no `swiftlint` on PATH skips
 *   loud rather than failing the gate — run `pnpm run setup:brew` to install
 *   it. Its format twin is `fmt-swift.mts`.
 */

// prefer-async-spawn: sync-required — sequential CLI gate, exit-code
// aggregation.
import path from 'node:path'
import process from 'node:process'

import { whichSync } from '@socketsecurity/lib-stable/exe/path/which'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { findSwiftTargetDirs } from './eco/swift-targets.mts'
import { isMainModule } from './process/is-main-module.mts'
import { runMain } from './process/run-main.mts'
import type { ScriptMeta } from './process/run-main.mts'
import { REPO_ROOT } from './paths.mts'

const logger = getDefaultLogger()

const fix = process.argv.includes('--fix')

/**
 * The `swiftlint` argv, shared across every target dir. Pure + exported so a
 * test asserts the `--fix` toggle without spawning swiftlint. Any argv flag
 * this script doesn't recognize is ignored rather than rejected — `main`
 * reads `--fix` via a plain `process.argv.includes`, never a strict parser.
 */
export function buildSwiftLintArgs(
  options?: { fix?: boolean | undefined } | undefined,
): string[] {
  const opts = { __proto__: null, ...options } as {
    fix?: boolean | undefined
  }
  return ['lint', '--strict', ...(opts.fix ? ['--fix'] : [])]
}

export function main(): void {
  const repoRoot = REPO_ROOT
  const targetDirs = findSwiftTargetDirs(repoRoot)
  if (!targetDirs.length) {
    logger.info('lint-swift: no Swift target found; nothing to lint.')
    return
  }
  const bin = whichSync('swiftlint', { nothrow: true })
  if (!bin || typeof bin !== 'string') {
    logger.warn(
      'lint-swift: swiftlint not on PATH — skipping (explicit skip, not a ' +
        'pass). Run `pnpm run setup:brew` to install it.',
    )
    return
  }
  const args = buildSwiftLintArgs({ fix })
  let failed = false
  for (let i = 0, { length } = targetDirs; i < length; i += 1) {
    const dir = targetDirs[i]!
    logger.info(
      `lint-swift: swiftlint ${args.join(' ')} (${path.relative(repoRoot, dir) || '.'})`,
    )
    const result = spawnSync(bin, args, { cwd: dir, stdio: 'inherit' })
    if (result.status !== 0) {
      failed = true
    }
  }
  if (failed) {
    logger.fail(
      fix
        ? 'lint-swift: swiftlint --fix failed.'
        : 'lint-swift: swiftlint findings. Fix: node scripts/fleet/lint-swift.mts --fix (autofixes only; the rest are hand fixes).',
    )
    process.exitCode = 1
    return
  }
  logger.info('lint-swift: clean.')
}

const SCRIPT_META: ScriptMeta = {
  describe: 'runs swiftlint over every first-party Swift target in the tree',
  help: `Usage: node scripts/fleet/lint-swift.mts [flags]

  --fix  apply swiftlint's machine-applicable autofixes`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
