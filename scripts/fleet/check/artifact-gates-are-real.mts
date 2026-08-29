#!/usr/bin/env node
/**
 * @file `check --all` gate: every gate named in the artifact-gate table exists,
 *   and every artifact kind on disk is covered by it. The table in
 *   .claude/hooks/fleet/_shared/artifact-gates.mts is what an authoring-time
 *   surface consults to run the right gates for the artifact being written. Two
 *   ways it rots, both silent: A renamed or deleted check leaves a dangling
 *   name, and the surface then runs one fewer gate than it reports — the
 *   artifact reads as gated when nothing looked at it. A NEW artifact kind
 *   added under .claude/ or .config/fleet/ with no table entry is enforced by
 *   nothing until `check --all`, which is the exact gap the table exists to
 *   close. Exit: 0 — every name resolves and every kind is covered; 1 — a
 *   dangling name or an uncovered kind. Usage: node
 *   scripts/fleet/check/artifact-gates-are-real.mts [--quiet]
 */

import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'
import { ARTIFACT_GATE_GROUPS } from '../../../.claude/hooks/fleet/_shared/artifact-gates.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

const quiet = process.argv.includes('--quiet')

/**
 * Artifact-bearing parents. A `fleet` subdir under one of these is a kind the
 * table has to name; anything else there is not an artifact tree.
 */
const KIND_PARENTS: readonly string[] = [
  '.claude/agents',
  '.claude/hooks',
  '.claude/rules',
  '.claude/skills',
]

/**
 * Gate names in the table with no matching check script.
 */
export function danglingGates(
  repoRoot: string,
  groups: ReadonlyArray<{ readonly gates: readonly string[] }>,
): string[] {
  const missing = new Set<string>()
  for (let i = 0, { length } = groups; i < length; i += 1) {
    const gates = groups[i]!.gates
    for (let j = 0, gateCount = gates.length; j < gateCount; j += 1) {
      const gate = gates[j]!
      const candidates = [
        path.join(repoRoot, 'template/base/scripts/fleet/check', `${gate}.mts`),
        path.join(repoRoot, 'scripts/fleet/check', `${gate}.mts`),
      ]
      if (!candidates.some(p => existsSync(p))) {
        missing.add(gate)
      }
    }
  }
  return [...missing].toSorted()
}

/**
 * Artifact kinds present on disk that the table does not cover.
 */
export function uncoveredKinds(
  repoRoot: string,
  groups: ReadonlyArray<{ readonly dir: string }>,
): string[] {
  const covered = new Set(groups.map(g => g.dir))
  const base = existsSync(path.join(repoRoot, 'template', 'base'))
    ? path.join(repoRoot, 'template', 'base')
    : repoRoot
  const found: string[] = []
  for (let i = 0, { length } = KIND_PARENTS; i < length; i += 1) {
    const parent = KIND_PARENTS[i]!
    const abs = path.join(base, parent)
    if (!existsSync(abs)) {
      continue
    }
    let entries: string[] = []
    try {
      entries = readdirSync(abs, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name)
    } catch {
      continue
    }
    for (let j = 0, entryCount = entries.length; j < entryCount; j += 1) {
      const dir = `${parent}/${entries[j]!}`
      // `_shared` / `_dist` are libraries, not artifact kinds.
      if (entries[j]!.startsWith('_')) {
        continue
      }
      if (!covered.has(dir)) {
        found.push(dir)
      }
    }
  }
  return found.toSorted()
}

export function main(): void {
  const dangling = danglingGates(REPO_ROOT, ARTIFACT_GATE_GROUPS)
  const uncovered = uncoveredKinds(REPO_ROOT, ARTIFACT_GATE_GROUPS)
  if (dangling.length === 0 && uncovered.length === 0) {
    if (!quiet) {
      const gateCount = new Set(ARTIFACT_GATE_GROUPS.flatMap(g => [...g.gates]))
        .size
      logger.log(
        `artifact-gates-are-real: ${ARTIFACT_GATE_GROUPS.length} artifact kind(s) map to ${gateCount} existing gate(s).`,
      )
    }
    process.exitCode = 0
    return
  }
  for (
    let i = 0, { length } = dangling.length ? dangling : [];
    i < length;
    i += 1
  ) {
    logger.fail(
      `artifact-gates.mts names \`${dangling[i]}\`, which is not a check under scripts/fleet/check/. A renamed gate leaves the surface running one fewer check than it reports, so the artifact reads as gated when nothing looked at it. Point the entry at the current name, or drop it.`,
    )
  }
  for (
    let i = 0, { length } = uncovered.length ? uncovered : [];
    i < length;
    i += 1
  ) {
    logger.fail(
      `${uncovered[i]} is an artifact kind with no artifact-gates.mts entry, so nothing enforces it until \`check --all\`. Add a group naming the gates that own it.`,
    )
  }
  process.exitCode = 1
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'checks the artifact-gate table names real checks and covers every kind',
  help: `Usage: node scripts/fleet/check/artifact-gates-are-real.mts [flags]
  --quiet  suppress the success message`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
