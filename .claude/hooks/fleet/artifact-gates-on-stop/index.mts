#!/usr/bin/env node
// Claude Code Stop hook - artifact-gates-on-stop.
//
// Fires at turn-end. For every artifact left dirty in the working tree (a hook,
// lint rule, skill, agent or rule), runs the gates that own that kind and
// refuses the stop while any of them fail.
//
// Why turn-end rather than per-save: a hook is four files, so a PreToolUse
// block would refuse the first three writes of every hook anyone ever adds. At
// turn-end the artifact is whole, and "did you leave it well-formed" is the
// question worth asking.
//
// Why it blocks rather than nudges: the gates it runs already existed and
// already said no. What was missing is anything running them before the
// artifact landed, so codifying-footguns shipped an over-long description, no
// catalog entry, and a citation to a script members did not have. Advice would
// reproduce that outcome one turn later.
//
// Scope comes from `git status --porcelain`, not a session ledger: whatever is
// dirty is what this turn would leave behind. A clean tree runs nothing, so the
// common turn pays one `git status`.

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  dirtyArtifactPaths,
  gatesForPorcelain,
} from '../_shared/artifact-gates.mts'
import { block, defineHook, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import { resolveRepoRoot } from '../_shared/repo-root.mts'
import { sortedStrings } from '../_shared/sorted-by.mts'
import { spawnTimeoutMs } from '../_shared/spawn-timeout.mts'

// Per-gate spawn budget before the win32 stretch.
const GATE_TIMEOUT_MS = 30_000

/**
 * How many touched artifacts the block message names before it stops listing.
 */
const NAMED_PATH_LIMIT = 5

/**
 * The check script for `gate`.
 *
 * The canonical copy, so the wheelhouse measures the source under review rather
 * than its own last cascade. A member has no `template/base`, and there the
 * live tree IS the only copy.
 */
export function gateScriptPath(repoRoot: string, gate: string): string {
  const canonical = path.join(
    repoRoot,
    'template',
    'base',
    'scripts',
    'fleet',
    'check',
    `${gate}.mts`,
  )
  const live = path.join(repoRoot, 'scripts', 'fleet', 'check', `${gate}.mts`)
  return existsSync(canonical) ? canonical : live
}

/**
 * Gates that fail, in the order they were run.
 *
 * A gate that cannot be spawned counts as failing: a surface that silently
 * skips an unrunnable gate reports a pass nobody earned.
 */
export function runGates(
  repoRoot: string,
  gates: readonly string[],
  run: (script: string) => number,
): string[] {
  const failed: string[] = []
  for (let i = 0, { length } = gates; i < length; i += 1) {
    const gate = gates[i]!
    if (run(gateScriptPath(repoRoot, gate)) !== 0) {
      failed.push(gate)
    }
  }
  return failed
}

/**
 * The block message: what failed, and the one command that reproduces it.
 */
export function failureMessage(
  failed: readonly string[],
  paths: readonly string[],
): string {
  const sortedFailed = sortedStrings([...failed])
  const named = sortedStrings([...paths]).slice(0, NAMED_PATH_LIMIT)
  const more =
    paths.length > named.length ? `, +${paths.length - named.length} more` : ''
  return (
    `artifact-gates-on-stop: ${sortedFailed.length} gate(s) red on the artifact(s) you touched - landing them red is how a malformed one reaches the next session.\n` +
    `Where: ${named.join(', ')}${more} (${sortedFailed.join(', ')})\n` +
    `Fix: node scripts/fleet/check/${sortedFailed[0]}.mts`
  )
}

function check(): GuardResult {
  // No process.cwd() fallback: a hook's cwd is whatever spawned it, so an
  // absent project dir means there is no repo to scope to.
  const projectDir = process.env['CLAUDE_PROJECT_DIR']
  if (!projectDir) {
    return undefined
  }
  const repoRoot = resolveRepoRoot(projectDir)
  const status = spawnSync('git', ['status', '--porcelain'], {
    cwd: repoRoot,
    stdioString: true,
  })
  if (status.status !== 0) {
    return undefined
  }
  const porcelain = status.stdout ?? ''
  const gates = gatesForPorcelain(porcelain)
  if (gates.length === 0) {
    return undefined
  }
  // A gate is `node <script> --quiet`, so it carries Node startup plus the
  // gate's own work - a longer base than the git-call sites that pass 5s.
  // spawnTimeoutMs stretches whatever base it is given on win32.
  const timeout = spawnTimeoutMs(GATE_TIMEOUT_MS)
  const failed = runGates(repoRoot, gates, script => {
    const result = spawnSync(process.execPath, [script, '--quiet'], {
      cwd: repoRoot,
      stdioString: true,
      timeout,
    })
    return result.status ?? 1
  })
  if (failed.length === 0) {
    return undefined
  }
  return block(failureMessage(failed, dirtyArtifactPaths(porcelain)))
}

export const hook = defineHook({
  check,
  event: 'Stop',
  type: 'guard',
})

void runHook(hook, import.meta.url)
