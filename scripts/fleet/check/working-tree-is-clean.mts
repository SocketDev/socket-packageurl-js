// Fleet check — the working tree is CLEAN: every change is committed.
//
// "Always wrap up with committing." An agent session that edits files and
// leaves them uncommitted abandons work - the next cascade or checkout silently
// drops it, and the change never reaches origin. This check fails (exit 1) when
// `git status --porcelain` reports any tracked modification or untracked file
// the fleet does not gitignore, so a session cannot end with loose edits. Run
// it before a push, at session end, or in CI: a red here means commit, stash,
// or discard - never push past it.
//
// Gitignored paths (node_modules/, dist/, .cache/, .worktrees/, ...) are not
// reported by `--porcelain`, so they are already out of scope. The check is
// intentionally strict: a genuine WIP-in-progress stages or stashes, it does
// not sit uncommitted across a gate.
//
// Usage: node scripts/fleet/check/working-tree-is-clean.mts [--quiet]

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { getCI } from '@socketsecurity/lib-stable/env/ci'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

/**
 * The `git status --porcelain` lines for the working tree under `repoRoot`,
 * empty when the tree is clean. `--porcelain` omits gitignored paths, so
 * node_modules / dist / .cache / .worktrees never appear. Pure over the git
 * result so a unit test can drive it with a stubbed spawn.
 */
/**
 * Whether a clean tree is a real expectation here. CI checks out a fresh tree,
 * so anything uncommitted is genuinely abandoned work. A developer checkout is
 * dirty by construction for most of a session — and in the wheelhouse it stays
 * dirty even at a push: the live `/fleet/` mirrors cannot be hand-committed
 * (no-fleet-fork-guard blocks it), so they sit modified until a cascade commit
 * sweeps them. Gating a local push on a clean tree is therefore unsatisfiable,
 * which is why this asserts only where the premise holds.
 */
export function cleanTreeIsExpected(): boolean {
  return getCI() || process.argv.includes('--release')
}

export function workingTreeChanges(): string[] {
  // Sync check runner: git status is a one-shot gate, not parallel work.
  // oxlint-disable-next-line socket/prefer-async-spawn -- sync gate
  const result = spawnSync('git', ['status', '--porcelain'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
  const out = String(result.stdout ?? '').trim()
  return out === '' ? [] : out.split(/\r?\n/)
}

export function main(): void {
  const quiet = process.argv.includes('--quiet')
  if (!cleanTreeIsExpected()) {
    if (!quiet) {
      logger.info(
        '[check-working-tree-is-clean] skipped — a clean tree is asserted on a fresh checkout (CI / --release), not mid-session.',
      )
    }
    return
  }
  const changes = workingTreeChanges()
  if (changes.length > 0) {
    logger.fail(
      '[check-working-tree-is-clean] the working tree has uncommitted changes.',
    )
    for (const line of changes) {
      logger.error(`  ${line}`)
    }
    logger.error(
      '  Fix:   commit, stash, or discard every change above - never push past',
    )
    logger.error(
      '         uncommitted work (it is silently dropped by the next cascade).',
    )
    process.exitCode = 1
    return
  }
  if (!quiet) {
    logger.success(
      '[check-working-tree-is-clean] working tree is clean - no uncommitted changes.',
    )
  }
}

const SCRIPT_META: ScriptMeta = {
  describe: 'fails when the working tree has any uncommitted change',
  help: `Usage: node scripts/fleet/check/working-tree-is-clean.mts [flags]

  --quiet  suppress the pass message`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
