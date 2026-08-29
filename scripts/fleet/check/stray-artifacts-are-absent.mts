#!/usr/bin/env node
/*
 * @file `check --all` gate: a tool's scratch output never lands in a checkout.
 *
 *   Sibling of `generated-outputs-are-untracked.mts`, which asks "is a build
 *   output TRACKED." This one closes the gap that check cannot see: an
 *   UNTRACKED dump sitting in the working tree. A commit- or push-time scan
 *   only sees staged paths, so a file nobody staged is invisible to it - and a
 *   stray file that is never staged is exactly the shape that lingers, gets
 *   swept into an unrelated `git add -A`, or confuses the next session.
 *
 *   (Incident: a browser-automation MCP tool auto-wrote
 *   `actionrunner-snapshot.yml` into the repo ROOT, outside its own gitignored
 *   `.playwright-mcp/` dir. Nothing caught it; it was noticed by eye and
 *   cleared by hand. The launcher now passes `--output-dir` outside any repo,
 *   which removes that one class at the source - this check is the backstop for
 *   every tool that has no such flag.)
 *
 *   PREVENTION FIRST, this second. A tool that can be pointed at a scratch dir
 *   outside the repo should be, in its launcher; this gate exists because not
 *   every tool offers the option and none of them can be trusted to keep it.
 *
 *   What counts as stray: an artifact-shaped basename in a NON-scratch
 *   directory. Scratch dirs are already gitignored on purpose
 *   (`.playwright-mcp/`, `coverage/`, `node_modules/`), and a deliberate
 *   fixture under `test/` is not a stray - so both are exempt.
 *
 *   Runs per-tree (wheelhouse + every member). Fails open when git is
 *   unavailable. Exit: 0 - clean / no git; 1 - a stray artifact is present.
 *
 *   Usage: node scripts/fleet/check/stray-artifacts-are-absent.mts [--quiet]
 */

import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import { REPO_ROOT } from '../paths.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

/**
 * Basenames a tool writes as scratch. A bare extension is too broad - a `.yml`
 * is usually config - so each entry is a SHAPE, not an extension.
 */
export const STRAY_BASENAME_PATTERNS: readonly RegExp[] = [
  // A snapshot/trace/dump a tool names after what it captured.
  /-snapshot\.(?:json|txt|ya?ml)$/,
  /-trace\.(?:json|ya?ml|zip)$/,
  /^snapshot-\d+\.(?:json|txt|ya?ml)$/,
  // Heap and profile dumps.
  /\.heapsnapshot$/,
  /\.cpuprofile$/,
  /^isolate-.*\.log$/,
  // Crash and core residue.
  /^core\.\d+$/,
  /\.stackdump$/,
]

/**
 * Directories whose contents are scratch BY DESIGN, so an artifact inside them
 * is not stray. Each is gitignored deliberately; this list must not grow to
 * paper over a tool that should be pointed elsewhere instead.
 */
export const SCRATCH_DIR_SEGMENTS: readonly string[] = [
  '.cache',
  '.playwright-mcp',
  'coverage',
  'coverage-isolated',
  'node_modules',
  'upstream',
]

/**
 * True when `relPath` sits inside a directory that is scratch by design.
 */
export function isInScratchDir(relPath: string): boolean {
  const parts = relPath.replaceAll('\\', '/').split('/')
  // The last element is the basename, so only the directory prefix is checked.
  for (let i = 0, end = parts.length - 1; i < end; i += 1) {
    if (SCRATCH_DIR_SEGMENTS.includes(parts[i]!)) {
      return true
    }
  }
  return false
}

/**
 * True when `relPath` is a deliberate test fixture rather than a stray dump.
 *
 * A fixture is committed on purpose and named descriptively; treating one as
 * stray would put this gate at odds with the fixture doctrine.
 */
export function isTestFixture(relPath: string): boolean {
  const norm = relPath.replaceAll('\\', '/')
  return norm.startsWith('test/') || norm.includes('/fixtures/')
}

/**
 * True when `relPath` looks like a tool's scratch output.
 */
export function isStrayArtifact(relPath: string): boolean {
  if (isInScratchDir(relPath) || isTestFixture(relPath)) {
    return false
  }
  const base = path.basename(relPath.replaceAll('\\', '/'))
  for (let i = 0, { length } = STRAY_BASENAME_PATTERNS; i < length; i += 1) {
    if (STRAY_BASENAME_PATTERNS[i]!.test(base)) {
      return true
    }
  }
  return false
}

/**
 * The stray artifacts among `paths`, sorted for a stable report.
 */
export function findStrayArtifacts(paths: readonly string[]): string[] {
  const out: string[] = []
  for (let i = 0, { length } = paths; i < length; i += 1) {
    const p = paths[i]!
    if (p && isStrayArtifact(p) && !out.includes(p)) {
      out.push(p)
    }
  }
  return out.toSorted()
}

/**
 * Every path git can see in the working tree: tracked, plus untracked that is
 * not ignored. `--others` is the half a staged-only scan misses.
 */
export async function worktreePaths(
  cwd: string,
): Promise<string[] | undefined> {
  const tracked = await gitFileList(cwd, ['ls-files'])
  if (tracked === undefined) {
    return undefined
  }
  const untracked = await gitFileList(cwd, [
    'ls-files',
    '--others',
    '--exclude-standard',
  ])
  return [...tracked, ...(untracked ?? [])]
}

/**
 * `git` stdout as a line list, or undefined when git is unavailable.
 */
async function gitFileList(
  cwd: string,
  args: readonly string[],
): Promise<string[] | undefined> {
  try {
    const result = (await spawn('git', [...args], {
      cwd,
      stdio: 'pipe',
      stdioString: true,
    })) as { stdout?: string | undefined }
    return String(result?.stdout ?? '')
      .split(/\r?\n/)
      .filter(line => line !== '')
  } catch {
    return undefined
  }
}

async function main(): Promise<void> {
  const quiet = process.argv.includes('--quiet')
  const paths = await worktreePaths(REPO_ROOT)
  if (paths === undefined) {
    // Fails open: no git means no verdict, not a red gate.
    if (!quiet) {
      logger.info('stray-artifacts-are-absent: no git; nothing to check.')
    }
    return
  }
  const strays = findStrayArtifacts(paths)
  if (!strays.length) {
    if (!quiet) {
      logger.success(
        'stray-artifacts-are-absent: no tool scratch in the checkout.',
      )
    }
    return
  }
  logger.fail(
    `stray-artifacts-are-absent: ${strays.length} stray artifact(s) in the checkout:`,
  )
  logger.group()
  for (let i = 0, { length } = strays; i < length; i += 1) {
    logger.substep(strays[i]!)
  }
  logger.groupEnd()
  logger.fail(
    'What: a tool wrote scratch output into the tree; it belongs outside any repo.',
  )
  logger.fail(
    'Fix: clear the listed path(s) from the tree, then re-point the writing tool at a scratch dir outside any repo, the way .config/fleet/playwright/launch-playwright-mcp.sh passes --output-dir. A genuinely-scratch DIRECTORY goes in SCRATCH_DIR_SEGMENTS with a reason, never a new basename pattern.',
  )
  process.exitCode = 1
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'fails when a tool wrote scratch output into the checkout, tracked or not',
  help: `Usage: node scripts/fleet/check/stray-artifacts-are-absent.mts [flags]

  --quiet   report only on failure`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
