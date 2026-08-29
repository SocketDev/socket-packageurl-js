#!/usr/bin/env node
/**
 * @file Fleet check - every workflow gets the fleet no-phone-home env knobs
 *   from exactly one place, and the right one for its shape. The rule points
 *   BOTH ways, decided per workflow by whether every job runs the shared setup
 *   action: Every job runs setup -> the action's first step already emits every
 *   knob into `$GITHUB_ENV`, so a workflow-level copy is drift and must go.
 *   That copy is the only way the set can fall behind, and it already did:
 *   OTEL_SDK_DISABLED was added to the list and to ci.yml, and
 *   github-release.yml went on carrying five of six through every release it
 *   cut. A job outside setup -> SKIPPED, not flagged. Nothing else supplies the
 *   posture there, so that workflow's block is load-bearing. The member release
 *   cut is this shape, running dep-free .mjs with no install. Whether such a
 *   job NEEDS the posture takes a signal this check does not have, so it does
 *   not guess: it enforces the one direction it can prove. Knob names come from
 *   the JSON rather than being spelled here, so adding a knob extends this gate
 *   with no edit and it cannot fall behind the list it guards. A knob named in
 *   a COMMENT passes; only a YAML key counts, since the comments explaining
 *   where the posture comes from have to name them. Usage: node
 *   scripts/fleet/check/workflow-env-is-action-supplied.mts [--json]
 *   [--quiet].
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { REPO_ROOT } from '../paths.mts'
import { collectTrackedFiles } from '../_shared/tracked-globs.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { isJsonRequested, runMain } from '../_shared/run-main.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

export const FLEET_ENV_JSON_REL = '.github/actions/fleet/setup/fleet-env.json'

export interface EnvKnobFinding {
  readonly file: string
  readonly knob: string
  readonly line: number
}

/**
 * Whether EVERY job in a workflow runs the shared setup action.
 *
 * This is what decides which direction the rule points. A workflow whose jobs
 * all run setup inherits the posture, so a copy is drift. A workflow with a job
 * that does not - the member release cut runs dep-free .mjs on the runner's
 * system Node with no install - has no other source, so the copy is
 * load-bearing and its ABSENCE is the defect.
 */
export function everyJobRunsSetup(text: string): boolean {
  const lines = text.split(/\r?\n/)
  let inJobs = false
  let sawJob = false
  let current = false
  let allCovered = true
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (line.startsWith('jobs:')) {
      inJobs = true
      continue
    }
    if (!inJobs) {
      continue
    }
    if (/^  [A-Za-z0-9_-]+:\s*$/.test(line)) {
      if (sawJob && !current) {
        allCovered = false
      }
      sawJob = true
      current = false
      continue
    }
    if (line.includes('actions/fleet/setup')) {
      current = true
    }
  }
  if (sawJob && !current) {
    allCovered = false
  }
  return sawJob && allCovered
}

/**
 * The knob names the setup action supplies, read from the one list.
 *
 * Throws rather than returning an empty set: with no names the scan would pass
 * every file and report success while guarding nothing.
 */
export function readKnobNames(repoRoot: string): string[] {
  const source = path.join(repoRoot, FLEET_ENV_JSON_REL)
  const parsed: unknown = JSON.parse(readFileSync(source, 'utf8'))
  const knobs =
    parsed !== null && typeof parsed === 'object' && 'knobs' in parsed
      ? (parsed as { knobs?: unknown | undefined }).knobs
      : undefined
  const names: string[] = []
  if (Array.isArray(knobs)) {
    for (const knob of knobs) {
      if (knob !== null && typeof knob === 'object' && 'name' in knob) {
        const { name } = knob as { name?: unknown | undefined }
        if (typeof name === 'string' && name.length > 0) {
          names.push(name)
        }
      }
    }
  }
  if (names.length === 0) {
    throw new Error(
      `What: no env knob names could be read.\nWhere: ${FLEET_ENV_JSON_REL}.\nSaw: an empty or unreadable knobs array; wanted at least one named knob.\nFix: repair the file. With no names this check would pass every workflow while guarding nothing.`,
    )
  }
  return names
}

/**
 * Lines in one workflow that declare a knob as a YAML key.
 *
 * A comment line is skipped: the comments that say where the posture comes from
 * name the knobs on purpose.
 */
export function findKnobKeys(
  text: string,
  knobNames: readonly string[],
): Array<{ knob: string; line: number }> {
  const hits: Array<{ knob: string; line: number }> = []
  const lines = text.split(/\r?\n/)
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    const trimmed = line.trimStart()
    if (trimmed.startsWith('#')) {
      continue
    }
    for (let j = 0, klen = knobNames.length; j < klen; j += 1) {
      const knob = knobNames[j]!
      if (trimmed.startsWith(`${knob}:`)) {
        hits.push({ knob, line: i + 1 })
      }
    }
  }
  return hits
}

/**
 * Whether a tracked path is a workflow file.
 *
 * Normalizes first, because a tracked path arrives with the host's separator
 * and this match is separator-sensitive: on Windows a backslash path would miss
 * the substring entirely and the gate would silently scan nothing.
 */
export function isWorkflowPath(file: string): boolean {
  return normalizePath(file).includes('.github/workflows/')
}

export interface EnvScan {
  readonly enforced: number
  readonly filesScanned: number
  readonly findings: EnvKnobFinding[]
  readonly knobsGuarded: number
}

export async function scanRepo(repoRoot: string): Promise<EnvScan> {
  const knobNames = readKnobNames(repoRoot)
  const tracked = await collectTrackedFiles(['**/*.yml', '**/*.yaml'], {
    cwd: repoRoot,
    dot: true,
    expectMatches: true,
  })
  const findings: EnvKnobFinding[] = []
  let enforced = 0
  let filesScanned = 0
  for (
    let i = 0, { length } = tracked.length ? tracked : [];
    i < length;
    i += 1
  ) {
    const file = normalizePath(tracked[i]!)
    if (!isWorkflowPath(file)) {
      continue
    }
    let text: string
    try {
      text = readFileSync(path.join(repoRoot, file), 'utf8')
    } catch {
      continue
    }
    filesScanned += 1
    // Only a workflow that CAN inherit is held to this. One with a job outside
    // setup - the member release cut runs dep-free .mjs with no install - has no
    // other source of the posture, so its block is load-bearing and is skipped.
    if (!everyJobRunsSetup(text)) {
      continue
    }
    enforced += 1
    for (const hit of findKnobKeys(text, knobNames)) {
      findings.push({ ...hit, file })
    }
  }
  return { enforced, filesScanned, findings, knobsGuarded: knobNames.length }
}

export function formatFailure(scan: EnvScan): string {
  return [
    `${scan.findings.length} location(s) hand-declare a knob the setup action already supplies:`,
    '',
    ...scan.findings.map(f => `  ${f.file}:${f.line}  ${f.knob}`),
    '',
    'Fix: delete the key. Every job in that workflow runs setup, whose first step',
    `emits the knobs into $GITHUB_ENV from ${FLEET_ENV_JSON_REL}, so a copy here is`,
    'the only way the set can drift.',
  ].join('\n')
}

export async function main(): Promise<number> {
  const scan = await scanRepo(REPO_ROOT)
  if (isJsonRequested(process.argv)) {
    logger.log(JSON.stringify(scan, undefined, 2))
    return scan.findings.length === 0 ? 0 : 1
  }
  if (scan.findings.length > 0) {
    logger.fail(formatFailure(scan))
    return 1
  }
  if (!process.argv.includes('--quiet')) {
    logger.success(
      `${scan.enforced} of ${scan.filesScanned} workflow(s) inherit all ${scan.knobsGuarded} fleet env knob(s) from the setup action; the rest run a job outside setup and keep their own block.`,
    )
  }
  return 0
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'checks no workflow hand-declares a fleet env knob the setup action already supplies',
  help: `Usage: node scripts/fleet/check/workflow-env-is-action-supplied.mts [flags]

  --json   emit the measurement as JSON instead of prose
  --quiet  suppress the pass message

Knob names are read from ${FLEET_ENV_JSON_REL}, so adding a knob extends this
check with no edit here. A knob named in a comment passes; only a YAML key
fails.`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
