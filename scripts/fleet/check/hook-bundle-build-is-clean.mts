// Fleet check — the fleet hook bundle build emits ZERO rolldown warnings.
//
// `scripts/fleet/build-hook-bundle.mts` bundles every dispatch-path hook into
// `_dist/fleet-pack.cjs`. A rolldown warning there is never cosmetic: an
// UNRESOLVED_IMPORT is a module the bundle cannot resolve (a lazy runtime
// require left dangling, or a dependency the wheelhouse context does not see),
// and an INVALID_ANNOTATION is a `#__PURE__`/`#__NO_SIDE_EFFECTS__` comment
// rolldown cannot interpret — both either break the bundle at require time or
// silently mis-shake the tree. This check runs the build, captures its output,
// and fails (exit 1) on any warning line, naming each one. Strict on purpose:
// warnings are tracked to zero, not tolerated.
//
// The build is idempotent (it rewrites the same `_dist/fleet-pack.cjs` bytes),
// so running it here is safe as a check. A bundle-only member has no hook
// source to build from — the source repo validates the build.
//
// Usage: node scripts/fleet/check/hook-bundle-build-is-clean.mts [--quiet]

import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
// sync check runner; the build spawn is a one-shot gate, not parallel work.
// oxlint-disable-next-line socket/prefer-async-spawn -- sync one-shot gate
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { REPO_ROOT } from '../paths.mts'
import { hasFleetHookSource } from '../_shared/fleet-source-present.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

// Rolldown warning markers. Kept as a single regex so a one-pass scan collects
// every kind. `Could not resolve` and `annotation that Rolldown` are the human
// prose rolldown wraps the bracketed codes in; the bracketed codes are the
// stable machine surface. Add new codes here as rolldown grows them.
const ROLLDOWN_WARNING_RE =
  /(?:Could not resolve|\[(?:CIRCULAR_DEPENDENCY|INVALID_ANNOTATION|INVALID_CONFIG|MISSING_EXPORT|PLUGIN_ERROR|UNRESOLVED_EXPORT|UNRESOLVED_IMPORT|WARNING)\]|annotation that Rolldown)/i

/**
 * The rolldown warning lines in `buildOutput` (combined stdout+stderr), empty
 * when the build is clean. Pure so a unit test can drive it without spawning
 * the build.
 */
export function hookBundleBuildWarnings(buildOutput: string): string[] {
  return buildOutput
    .split(/\r?\n/)
    .filter(line => ROLLDOWN_WARNING_RE.test(line))
}

export function main(): void {
  const quiet = process.argv.includes('--quiet')
  // A bundle-only member carries no per-hook SOURCE dirs to build from; the
  // build is validated at the source repo.
  if (!hasFleetHookSource(REPO_ROOT)) {
    if (!quiet) {
      logger.log(
        '[check-hook-bundle-build-is-clean] no fleet hook source (bundle-only) — build validated at the source repo.',
      )
    }
    return
  }
  const buildScript = 'scripts/fleet/build-hook-bundle.mts'
  const result = spawnSync(process.execPath, [buildScript], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    // The build speaks progress on stdout and diagnostics on stderr; both can
    // carry rolldown warnings, so capture and scan them together.
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const combined = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  const warnings = hookBundleBuildWarnings(combined)
  if (warnings.length > 0) {
    logger.fail(
      '[check-hook-bundle-build-is-clean] rolldown emitted build warnings.',
    )
    for (const line of warnings) {
      // Trim the ANSI colour rolldown wraps warnings in so the failure message
      // is readable in any terminal.
      logger.error(`  ${line.replace(/\u001B\[[0-9;]*m/g, '').trim()}`)
    }
    logger.error(
      '  Fix:   resolve each warning at its source (mark a runtime require external,',
    )
    logger.error(
      '         reword a misread annotation comment, etc.) — warnings are tracked to zero.',
    )
    process.exitCode = 1
    return
  }
  if (result.status !== 0 && result.error) {
    logger.fail(
      '[check-hook-bundle-build-is-clean] the build itself failed to spawn.',
    )
    logger.error(`  ${String(result.error.message)}`)
    process.exitCode = 1
    return
  }
  if (!quiet) {
    logger.success(
      '[check-hook-bundle-build-is-clean] hook bundle build is warning-free.',
    )
  }
}

const SCRIPT_META: ScriptMeta = {
  describe: 'fails when the fleet hook bundle build emits any rolldown warning',
  help: `Usage: node scripts/fleet/check/hook-bundle-build-is-clean.mts [flags]

  --quiet  suppress the pass message`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
