#!/usr/bin/env node
/*
 * @file Fleet-wide check: first-party TypeScript is `.mts`, not `.ts`.
 *
 *   The fleet writes ESM and names it so. A stray `.ts` is not a style nit,
 *   it is a file the surrounding tooling can miss: globs are written for the
 *   convention, and a target that falls outside one stops being collected
 *   while the suite still reports green. socket-packageurl-js carried exactly
 *   that (2026-08-14) - one `test/**\/*.fuzz.ts` target beside a vitest glob
 *   of the same shape, where renaming the file without the glob would have
 *   silently dropped it from the fuzz run.
 *
 *   Conversions also drag: socket-webext sat at 120 `.mts` against 18 `.ts`
 *   for long enough that NEW files were landing on the wrong side. A check
 *   is what stops a half-finished migration from being permanent.
 *
 *   `.d.ts` is exempt: ambient declaration files are not modules, and
 *   `.d.mts` changes how they are picked up. Vendored trees (node_modules,
 *   dist, generated payloads) are not ours to rename.
 *
 *   Exit codes:
 *   - 0 — no first-party `.ts` outside the exemptions
 *   - 1 — at least one stray found
 *
 *   Usage: node scripts/fleet/check/sources-are-mts.mts [--quiet]
 */

import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { gitSync } from '../git/exec.mts'

import { REPO_ROOT } from '../paths.mts'
import { collectTrackedFiles } from '../fs/tracked-globs.mts'
import { isMainModule } from '../process/is-main-module.mts'
import { runMain } from '../process/run-main.mts'

import type { ScriptMeta } from '../process/run-main.mts'

const logger = getDefaultLogger()

/**
 * Whether a repo-relative path is a stray: a first-party `.ts` that should be
 * `.mts`.
 *
 * `.d.ts` and `.d.cts` are declaration files, not modules, and stay. `.cts` is
 * a deliberate CommonJS choice and stays. Pure - exported for tests.
 */
export function isStrayTypeScript(relPath: string): boolean {
  const normalized = normalizePath(relPath)
  if (!normalized.endsWith('.ts')) {
    return false
  }
  if (normalized.endsWith('.d.ts')) {
    return false
  }
  return true
}

/**
 * Whether `repoRoot` is inside a git checkout.
 *
 * Checked BEFORE enumerating, because collectTrackedFiles deliberately falls
 * back to the raw glob when the tracked set is empty - that fallback is what
 * keeps mkdtemp fixtures working across the fleet, and it cannot tell "no
 * tracked files" from "git broke". Inheriting it here would resurrect the
 * false positive this check was written to kill: verified on a non-git tree
 * with an ignored `upstream/`, the raw glob reports the vendored files.
 */
export function isGitCheckout(repoRoot: string): boolean {
  const result = gitSync(['rev-parse', '--git-dir'], {
    cwd: repoRoot,
  })
  return result.status === 0
}

/**
 * Every stray `.ts` under `repoRoot`, repo-relative and sorted.
 *
 * Enumerates through `collectTrackedFiles`, the fleet's gitignore- and
 * submodule-aware collector, rather than a bare glob or a hand-rolled
 * `git ls-files`. A bare glob reported 177 strays here, 175 of them under an
 * ignored vendored `upstream/` tree; the collector also prunes submodule
 * mounts and nested worktrees, whose symlink cycles otherwise blow a walker up
 * with ENAMETOOLONG.
 *
 * Tracked-only is deliberate. An untracked scratch file is not yet part of the
 * repo, and reddening a check over one would fire locally and never in CI.
 */
export async function findStrayTypeScript(repoRoot: string): Promise<string[]> {
  if (!isGitCheckout(repoRoot)) {
    logger.warn(
      'sources-are-mts: not a git checkout, skipping (cannot tell ours from vendored).',
    )
    return []
  }
  const found = await collectTrackedFiles(['**/*.ts'], {
    cwd: repoRoot,
    dot: true,
  })
  const strays: string[] = []
  for (let i = 0, { length } = found; i < length; i += 1) {
    const rel = found[i]!
    if (isStrayTypeScript(rel)) {
      strays.push(rel)
    }
  }
  return strays.toSorted()
}

export async function main(): Promise<void> {
  const quiet = process.argv.includes('--quiet')
  const strays = await findStrayTypeScript(REPO_ROOT)
  if (strays.length === 0) {
    if (!quiet) {
      logger.success('sources-are-mts: no stray .ts files.')
    }
    return
  }
  logger.fail(
    [
      `sources-are-mts: ${strays.length} first-party .ts file(s) should be .mts.`,
      '  Where:',
      ...strays.map(rel => `    ${rel}`),
      '  Fix: rename it, and move any glob that named the old extension in the same change.',
    ].join('\n'),
  )
  process.exitCode = 1
}

const SCRIPT_META: ScriptMeta = {
  describe: 'checks that first-party TypeScript is .mts rather than .ts',
  help: `Usage: node scripts/fleet/check/sources-are-mts.mts [flags]

  --quiet  print nothing on success`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
