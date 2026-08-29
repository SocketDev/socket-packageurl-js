/**
 * @file Owning formatter for a repo's first-party Swift: run `swift-format`
 *   for every Swift target dir in the tree (an Xcode project/workspace or a
 *   Swift package), skipping vendored/generated code. Modes:
 *   node scripts/fleet/fmt-swift.mts           # rewrite
 *   node scripts/fleet/fmt-swift.mts --check   # verify only (CI / pre-push)
 *   `--check` maps to swift-format's own `lint --strict` subcommand rather
 *   than a non-mutating `format` call (which still needs a separate diff step
 *   to detect drift) — `lint --strict` fails loudly on any style violation and
 *   never writes, matching gofmt -l's non-mutating verify contract. Target
 *   discovery is shared with `lint-swift.mts` via `_shared/swift-targets.mts`.
 *   A machine with no `swift-format` on PATH skips loud rather than failing
 *   the gate — run `pnpm run setup:brew` to install it. Its lint twin is
 *   `lint-swift.mts`.
 */

// prefer-async-spawn: sync-required — sequential CLI gates, exit-code
// aggregation.
import path from 'node:path'
import process from 'node:process'

import { whichSync } from '@socketsecurity/lib-stable/bin/which'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { findSwiftTargetDirs } from './_shared/swift-targets.mts'
import { isMainModule } from './_shared/is-main-module.mts'
import { runMain } from './_shared/run-main.mts'
import type { ScriptMeta } from './_shared/run-main.mts'
import { REPO_ROOT } from './paths.mts'

const logger = getDefaultLogger()

const check = process.argv.includes('--check')

/**
 * The `swift-format` argv for one target dir. Pure + exported so a test
 * asserts the `--check` toggle without spawning swift-format. `--check` maps
 * to `lint --strict`, never a mutating `format` call — see the file header for
 * why.
 */
export function buildSwiftFormatArgs(
  dir: string,
  options?: { check?: boolean | undefined } | undefined,
): string[] {
  const opts = { __proto__: null, ...options } as {
    check?: boolean | undefined
  }
  return opts.check
    ? ['lint', '--strict', '--recursive', dir]
    : ['format', '--in-place', '--recursive', dir]
}

export function main(): void {
  const repoRoot = REPO_ROOT
  const targetDirs = findSwiftTargetDirs(repoRoot)
  if (!targetDirs.length) {
    logger.info('fmt-swift: no Swift target found; nothing to format.')
    return
  }
  const bin = whichSync('swift-format', { nothrow: true })
  if (!bin || typeof bin !== 'string') {
    logger.warn(
      'fmt-swift: swift-format not on PATH — skipping (explicit skip, not a ' +
        'pass). Run `pnpm run setup:brew` to install it.',
    )
    return
  }
  let failed = false
  for (let i = 0, { length } = targetDirs; i < length; i += 1) {
    const dir = targetDirs[i]!
    const args = buildSwiftFormatArgs(dir, { check })
    logger.info(
      `fmt-swift: swift-format ${args.join(' ')} (${path.relative(repoRoot, dir) || '.'})`,
    )
    const result = spawnSync(bin, args, { cwd: repoRoot, stdio: 'inherit' })
    if (result.status !== 0) {
      failed = true
    }
  }
  if (failed) {
    logger.fail(
      check
        ? 'fmt-swift: formatting drift found. Fix: node scripts/fleet/fmt-swift.mts'
        : 'fmt-swift: swift-format failed.',
    )
    process.exitCode = 1
    return
  }
  logger.info('fmt-swift: clean.')
}

const SCRIPT_META: ScriptMeta = {
  describe: 'run swift-format over every first-party Swift target in the tree',
  help: `Usage: node scripts/fleet/fmt-swift.mts [flags]
  --check  verify only; exit non-zero on formatting drift (swift-format lint --strict)`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
