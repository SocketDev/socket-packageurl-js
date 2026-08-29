#!/usr/bin/env node
/*
 * @file Gate: every fleet artifact ships all of its parts and a test.
 *
 *   "A feature is not done until it has code-as-law enforcement, tests, and
 *   preflight wiring" is doctrine, but nothing checked the SHAPE of the
 *   enforcer itself. A hook that ships only its entry file still dispatches, so
 *   nothing goes red: no `package.json` means the lockfile carries no importer
 *   for it, and no `README.md` means the trigger, the silence condition and the
 *   bypass slug live only in the source. Measured when this was written: 104
 *   of 336 hook directories were missing at least one part.
 *
 *   The entry file is any-of, because the tree holds two shapes: a dispatched
 *   hook ships `index.mts`, an installer beside it ships `install.mts` and is
 *   never dispatched. Demanding one exact name reported five installers as
 *   missing an entry that was sitting right there.
 *
 *   The two kinds checked here are the ones with a multi-file shape and an
 *   executable subject. Agents, rules, output styles and skills are prose with
 *   their own owning checks (`claude-md-rules-are-enforced`,
 *   `skills-are-well-formed`), and duplicating those here would be a second
 *   enforcer for one doctrine.
 *
 *   Shrink-only burn-down. The backlog is seeded from the day this landed, so a
 *   NEW artifact is gated strictly while the existing gaps burn down; an entry
 *   that has been fixed is reported so the list cannot grow stale, exactly like
 *   the fixture-name and canonical-sources burn-downs.
 *
 *   Exit codes: 0 — every artifact outside the burn-down is complete; 1 — a
 *   gap outside the burn-down, or a stale burn-down entry.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import { REPO_ROOT } from '../paths.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

const BURN_DOWN_FILE = path.join(
  'scripts',
  'fleet',
  'constants',
  'artifact-completeness-burn-down.json',
)

export interface ArtifactKind {
  /**
   * Directory holding one subdirectory per artifact, repo-relative.
   */
  readonly dir: string
  /**
   * Human name used in the report.
   */
  readonly label: string
  /**
   * Entry filenames, ANY ONE of which satisfies the requirement.
   *
   * A dispatched hook ships `index.mts`; an installer under the same tree ships
   * `install.mts` and is never dispatched. Demanding one exact name would
   * report every installer as missing its entry while the file sits right
   * there.
   */
  readonly entryFiles: readonly string[]
  /**
   * Files every artifact of this kind must ship.
   */
  readonly requiredFiles: readonly string[]
  /**
   * Directories a `<name>.test.mts` may live in, repo-relative.
   */
  readonly testDirs: readonly string[]
}

/**
 * The artifact kinds with a multi-file shape and an executable subject.
 *
 * `testDirs` lists every place the fleet actually puts a test for the kind, so
 * a hook covered by an integration test is not reported as untested just
 * because the unit directory is empty.
 */
export const ARTIFACT_KINDS: readonly ArtifactKind[] = [
  {
    dir: path.join('.claude', 'hooks', 'fleet'),
    entryFiles: ['index.mts', 'install.mts'],
    label: 'hook',
    requiredFiles: ['README.md', 'package.json', 'tsconfig.json'],
    testDirs: [
      path.join('test', 'repo', 'unit', 'hooks'),
      path.join('test', 'repo', 'integration', 'hooks'),
      path.join('test', 'repo', 'unit'),
      path.join('test', 'repo', 'integration'),
    ],
  },
  {
    dir: path.join('.config', 'fleet', 'oxlint-plugin', 'fleet'),
    entryFiles: ['index.mts'],
    label: 'lint rule',
    requiredFiles: [],
    testDirs: [
      path.join('test', 'repo', 'unit', 'lint-rules'),
      path.join('test', 'repo', 'integration', 'lint-rules'),
    ],
  },
]

export interface ArtifactGap {
  readonly kind: string
  readonly name: string
  /**
   * Required files that are absent.
   */
  readonly missingFiles: readonly string[]
  /**
   * True when no `<name>.test.mts` exists in any of the kind's test dirs.
   */
  readonly missingTest: boolean
}

/**
 * A stable key for the burn-down list.
 */
export function gapKey(gap: Pick<ArtifactGap, 'kind' | 'name'>): string {
  return `${gap.kind}:${gap.name}`
}

/**
 * Where this kind's artifacts live.
 *
 * Two roots, deliberately. An artifact is read from `template/base` because
 * that is the canonical copy the cascade ships; the live tree beside it is a
 * generated read-only mirror, so measuring it would report the last cascade
 * rather than the source under review. Tests are NOT cascaded and live at the
 * repo root, which is why they resolve separately. A member repo has no
 * `template/`, so it falls back to its own tree.
 */
export function artifactRoot(repoRoot: string, kind: ArtifactKind): string {
  const templated = path.join(repoRoot, 'template', 'base', kind.dir)
  return existsSync(templated) ? templated : path.join(repoRoot, kind.dir)
}

/**
 * Artifact names of one kind. A leading underscore marks a shared library
 * rather than an artifact (`_shared`, `_dist`), so those are not artifacts and
 * carry no shape of their own.
 */
export function artifactNames(repoRoot: string, kind: ArtifactKind): string[] {
  const root = artifactRoot(repoRoot, kind)
  if (!existsSync(root)) {
    return []
  }
  return readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('_'))
    .map(entry => entry.name)
    .toSorted()
}

/**
 * Whether any of `kind`'s test dirs holds `<name>.test.mts`.
 */
export function hasTest(
  repoRoot: string,
  kind: ArtifactKind,
  name: string,
): boolean {
  for (const dir of kind.testDirs) {
    if (existsSync(path.join(repoRoot, dir, `${name}.test.mts`))) {
      return true
    }
  }
  return false
}

/**
 * Whether this repo OWNS the fleet artifacts, i.e. carries the canonical
 * `template/base` copy the cascade ships from.
 *
 * Only the wheelhouse does. In a member both artifact dirs are cascaded
 * payload, and their tests are NOT cascaded with them (see artifactRoot), so
 * measuring completeness there reports the entire payload as untested -- 465
 * hooks in socket-lib -- for a gap no member edit could ever close.
 */
export function ownsFleetArtifacts(repoRoot: string): boolean {
  return existsSync(path.join(repoRoot, 'template', 'base'))
}

/**
 * Every incomplete artifact, across every kind.
 */
export function findArtifactGaps(repoRoot: string): ArtifactGap[] {
  const gaps: ArtifactGap[] = []
  if (!ownsFleetArtifacts(repoRoot)) {
    return gaps
  }
  for (let i = 0, { length } = ARTIFACT_KINDS; i < length; i += 1) {
    const kind = ARTIFACT_KINDS[i]!
    const root = artifactRoot(repoRoot, kind)
    const names = artifactNames(repoRoot, kind)
    for (let j = 0, nameCount = names.length; j < nameCount; j += 1) {
      const name = names[j]!
      const missingFiles = kind.requiredFiles.filter(
        file => !existsSync(path.join(root, name, file)),
      )
      const hasEntry = kind.entryFiles.some(file =>
        existsSync(path.join(root, name, file)),
      )
      if (!hasEntry) {
        missingFiles.unshift(kind.entryFiles.join(' or '))
      }
      const missingTest = !hasTest(repoRoot, kind, name)
      if (missingFiles.length || missingTest) {
        gaps.push({ kind: kind.label, missingFiles, missingTest, name })
      }
    }
  }
  return gaps
}

/**
 * The burn-down list, or an empty set when the file is absent.
 *
 * Prefers the `template/base` copy for the same reason the artifacts are read
 * from there: the live constant is a cascaded mirror, so a freshly shrunk list
 * is only visible at the source until the next cascade runs.
 */
export function readBurnDown(repoRoot: string): Set<string> {
  const templated = path.join(repoRoot, 'template', 'base', BURN_DOWN_FILE)
  const file = existsSync(templated)
    ? templated
    : path.join(repoRoot, BURN_DOWN_FILE)
  if (!existsSync(file)) {
    return new Set()
  }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown
    const entries = Array.isArray(parsed)
      ? parsed
      : ((parsed as { entries?: unknown[] | undefined } | null)?.entries ?? [])
    return new Set(entries.filter((e): e is string => typeof e === 'string'))
  } catch {
    return new Set()
  }
}

export interface ArtifactVerdict {
  /**
   * Gaps not covered by the burn-down. These fail.
   */
  readonly fresh: ArtifactGap[]
  /**
   * Burn-down entries that are complete now. The list only shrinks.
   */
  readonly cleared: string[]
}

export function judgeArtifacts(
  gaps: readonly ArtifactGap[],
  burnDown: ReadonlySet<string>,
): ArtifactVerdict {
  const seen = new Set(gaps.map(gapKey))
  return {
    cleared: [...burnDown].filter(entry => !seen.has(entry)).toSorted(),
    fresh: gaps.filter(gap => !burnDown.has(gapKey(gap))),
  }
}

/**
 * One report line for a gap.
 */
export function describeGap(gap: ArtifactGap): string {
  const parts: string[] = []
  if (gap.missingFiles.length) {
    parts.push(`missing ${gap.missingFiles.join(', ')}`)
  }
  if (gap.missingTest) {
    parts.push('no test')
  }
  return `${gap.kind} ${gap.name}: ${parts.join('; ')}`
}

export async function main(): Promise<void> {
  const isQuiet = process.argv.includes('--quiet')
  const gaps = findArtifactGaps(REPO_ROOT)
  const { cleared, fresh } = judgeArtifacts(gaps, readBurnDown(REPO_ROOT))

  if (fresh.length) {
    logger.fail(
      `[fleet-artifacts-are-complete] ${fresh.length} artifact(s) are missing a part or a test.`,
    )
    logger.group()
    for (const gap of fresh) {
      logger.error(describeGap(gap))
    }
    logger.error(
      'Fix: add the missing part(s). A hook ships README.md + index.mts + package.json + tsconfig.json; a lint rule ships index.mts. Every one needs a same-named <name>.test.mts. Copy the shape from a sibling rather than inventing one.',
    )
    logger.groupEnd()
    process.exitCode = 1
  }

  if (cleared.length) {
    logger.warn(
      `[fleet-artifacts-are-complete] ${cleared.length} burn-down entry(s) are complete now.`,
    )
    logger.group()
    for (const entry of cleared) {
      logger.warn(entry)
    }
    logger.warn(`Remove them from ${BURN_DOWN_FILE} — the list only shrinks.`)
    logger.groupEnd()
    process.exitCode = 1
  }

  if (!fresh.length && !cleared.length && !isQuiet) {
    logger.log(
      `[fleet-artifacts-are-complete] ok — every artifact outside the burn-down ships its parts and a test (${gaps.length} known gap(s))`,
    )
  }
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'checks every fleet hook and lint rule ships its required files and a same-named test',
  help: `Usage: node scripts/fleet/check/fleet-artifacts-are-complete.mts [flags]

  --quiet  silent on clean`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
