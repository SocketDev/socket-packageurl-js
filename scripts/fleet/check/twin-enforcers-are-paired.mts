#!/usr/bin/env node
/*
 * @file `check --all` gate: an `-at-edit` enforcer has its `-at-commit` twin,
 *   and the other way round.
 *
 *   A policy worth enforcing twice gets enforced twice here: an oxlint rule or
 *   a Claude hook catches it as you write, and a check re-scans committed
 *   source for whatever was written before the guard existed or landed around
 *   it. That pairing is deliberate and documented in
 *   docs/agents.md/fleet/twin-enforcers.md.
 *
 *   What it was NOT is discoverable. The path-normalization policy shipped as
 *   `normalize-path-before-match` (rule) and
 *   `paths-are-normalized-before-match` (check) — two names that read as
 *   unrelated enforcers, so finding one told you nothing about the other. Every
 *   twin family had the same problem in its own way:
 *   `gitignore-is-single-file-at-edit` beside `gitignore-is-single-file-at-commit`,
 *   `markdown-filenames-are-canonical-at-edit` beside `markdown-filenames-are-canonical-at-commit`.
 *
 *   So the name carries the relationship: one base, and a suffix that says WHEN
 *   the enforcer runs. `<base>-at-edit` blocks or nudges while the edit is
 *   being made; `<base>-at-commit` scans what is already committed.
 *
 *   Deriving the pairing from the NAME rather than from a declaration is the
 *   point. An earlier attempt read each check's header prose for a phrase
 *   naming its counterpart, and that cannot be relied on: the phrasings vary
 *   ("point-of-use", "edit-time twin is", "write-time twin", "predicate from
 *   the … hook"), a reworded comment silently unpairs a family, and an
 *   `oxlint-disable` line mentioning an unrelated rule reads as a twin. Naming
 *   is the one declaration that cannot drift from itself.
 *
 *   SCOPE. This sees only names that already use the suffixes. A family that
 *   has not adopted them produces no finding, so there is no burn-down list
 *   here to excuse one: an unmigrated family is tracked in the doc's table
 *   instead. What the gate guarantees is that adopting the convention halfway
 *   is impossible - name one half and the other becomes mandatory.
 *
 *   Usage: node scripts/fleet/check/twin-enforcers-are-paired.mts [--json]
 */

import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import { REPO_ROOT } from '../paths.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

export const EDIT_SUFFIX = '-at-edit'
export const COMMIT_SUFFIX = '-at-commit'

/**
 * Where each kind of enforcer lives, relative to the repo root. The template
 * tree is the source of truth: the live mirrors are hydrated from it.
 */
export const CHECK_DIR = path.join(
  'template',
  'base',
  'scripts',
  'fleet',
  'check',
)
export const HOOK_DIR = path.join(
  'template',
  'base',
  '.claude',
  'hooks',
  'fleet',
)
export const RULE_DIR = path.join(
  'template',
  'base',
  '.config',
  'fleet',
  'oxlint-plugin',
  'fleet',
)

export interface TwinFinding {
  readonly base: string
  readonly have: string
  readonly want: string
}

/**
 * Directory names under `dir`, or empty when it is absent.
 */
export function listDirs(root: string, dir: string): string[] {
  const abs = path.join(root, dir)
  if (!existsSync(abs)) {
    return []
  }
  try {
    return readdirSync(abs, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
  } catch {
    return []
  }
}

/**
 * Check basenames under `dir`, or empty when it is absent.
 */
export function listChecks(root: string, dir: string): string[] {
  const abs = path.join(root, dir)
  if (!existsSync(abs)) {
    return []
  }
  try {
    return readdirSync(abs)
      .filter(name => name.endsWith('.mts'))
      .map(name => name.slice(0, -'.mts'.length))
  } catch {
    return []
  }
}

/**
 * The bases named `<base>-at-edit` among `names`.
 */
export function editBases(names: readonly string[]): string[] {
  const out: string[] = []
  for (let i = 0, { length } = names; i < length; i += 1) {
    const name = names[i]!
    if (name.endsWith(EDIT_SUFFIX)) {
      out.push(name.slice(0, -EDIT_SUFFIX.length))
    }
  }
  return out
}

/**
 * The bases named `<base>-at-commit` among `names`.
 */
export function commitBases(names: readonly string[]): string[] {
  const out: string[] = []
  for (let i = 0, { length } = names; i < length; i += 1) {
    const name = names[i]!
    if (name.endsWith(COMMIT_SUFFIX)) {
      out.push(name.slice(0, -COMMIT_SUFFIX.length))
    }
  }
  return out
}

/**
 * Every base named on one side of the convention but not the other. Pure over
 * the two base lists, so the rule is testable without a tree walk.
 */
export function findUnpaired(
  edit: readonly string[],
  commit: readonly string[],
): TwinFinding[] {
  const editSet = new Set(edit)
  const commitSet = new Set(commit)
  const findings: TwinFinding[] = []
  for (const base of new Set(edit)) {
    if (!commitSet.has(base)) {
      findings.push({
        base,
        have: `${base}${EDIT_SUFFIX}`,
        want: `${base}${COMMIT_SUFFIX}`,
      })
    }
  }
  for (const base of new Set(commit)) {
    if (!editSet.has(base)) {
      findings.push({
        base,
        have: `${base}${COMMIT_SUFFIX}`,
        want: `${base}${EDIT_SUFFIX}`,
      })
    }
  }
  return findings.toSorted((a, b) => a.base.localeCompare(b.base))
}

function main(): number {
  const edit = [
    ...editBases(listDirs(REPO_ROOT, HOOK_DIR)),
    ...editBases(listDirs(REPO_ROOT, RULE_DIR)),
  ]
  const commit = commitBases(listChecks(REPO_ROOT, CHECK_DIR))
  const findings = findUnpaired(edit, commit)

  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify({ findings }, undefined, 2)}\n`)
    return findings.length === 0 ? 0 : 1
  }
  if (findings.length === 0) {
    logger.success(
      `[twin-enforcers-are-paired] every -at-edit enforcer has its -at-commit twin (${commit.length} paired).`,
    )
    return 0
  }
  for (let i = 0, { length } = findings; i < length; i += 1) {
    const finding = findings[i]!
    logger.fail(
      `[twin-enforcers-are-paired] ${finding.have} has no ${finding.want}.`,
    )
  }
  logger.error(
    'Wanted: one base per policy, with a suffix saying when it runs. ' +
      'Fix: add the missing twin, or rename the existing one so the pair ' +
      'shares a base (docs/agents.md/fleet/twin-enforcers.md).',
  )
  return 1
}

const SCRIPT_META: ScriptMeta = {
  describe: 'checks every -at-edit enforcer has its -at-commit twin',
  help: `Usage: node scripts/fleet/check/twin-enforcers-are-paired.mts [flags]
  --json   print the findings as JSON`,
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  runMain(() => {
    process.exitCode = main()
  }, SCRIPT_META)
}
/* c8 ignore stop */
