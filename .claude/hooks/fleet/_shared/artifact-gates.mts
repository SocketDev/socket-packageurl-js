/*
 * @file Which gates govern which artifact kind — the narrow path for ADDING a
 *   hook, lint rule, skill, agent, rule or output style.
 *
 *   The fleet already carries a gate for nearly every rule about these
 *   artifacts. The gap was WHEN they run: `check --all` catches a malformed
 *   artifact long after it was authored, so a broken one lands and the next
 *   session inherits it. codifying-footguns shipped with an over-long
 *   description, no catalog entry, and a citation to a script members did not
 *   have — every one of those was already gated, and none of the gates ran
 *   until much later.
 *
 *   So this maps a path to the gates that already own it, letting an
 *   authoring-time surface run exactly those and nothing else. Adding an
 *   artifact kind here is what makes it enforced; a kind absent from this table
 *   is a kind nobody checks until `check --all`.
 *
 *   Everything is a pure function over strings, so the table is unit-testable
 *   without a repo, a git call or a subprocess.
 */

import { sortedStrings } from './sorted-by.mts'

/**
 * One artifact kind and the gates that own it.
 */
export interface ArtifactGateGroup {
  /**
   * Repo-relative directory prefix, forward slashes, no trailing slash. Matched
   * against BOTH the canonical `template/base/<dir>` and a member's bare
   * `<dir>`, because the same artifact is authored in one and cascaded to the
   * other.
   */
  readonly dir: string
  /**
   * What a reader calls one of these.
   */
  readonly label: string
  /**
   * Check names under `scripts/fleet/check/`, without the `.mts`. Every one is
   * asserted to exist by artifact-gates-are-real, so a rename cannot leave a
   * dangling citation here.
   */
  readonly gates: readonly string[]
}

/**
 * The table. Gate lists are the CONSENSUS already encoded in
 * scripts/fleet/check/ — this adds no new rules, it only says which existing
 * ones apply where.
 */
export const ARTIFACT_GATE_GROUPS: readonly ArtifactGateGroup[] = [
  {
    dir: '.claude/agents/fleet',
    label: 'agent',
    gates: [
      'agent-offload-routes-are-declared',
      'agents-are-well-formed',
      'agents-have-rule-citations',
    ],
  },
  {
    dir: '.claude/hooks/fleet',
    label: 'hook',
    gates: [
      'fleet-artifacts-are-complete',
      'guard-blocks-are-pithy',
      'hook-dirs-are-not-husks',
      'hook-main-is-entrypoint-guarded',
      'hook-names-are-accurate',
      'hook-verdicts-are-typed',
      'hooks-have-no-guard-nudge-overlap',
      'twin-enforcers-are-paired',
    ],
  },
  {
    dir: '.claude/output-styles',
    label: 'output style',
    gates: ['output-styles-are-well-formed'],
  },
  {
    dir: '.claude/rules/fleet',
    label: 'rule',
    gates: [
      'claude-md-rules-are-enforced',
      'rule-citations-are-generic-at-commit',
    ],
  },
  {
    dir: '.claude/skills/fleet',
    label: 'skill',
    gates: [
      'mutating-skills-have-model',
      'skill-delegations-resolve',
      'skill-system-is-coherent',
      'skills-are-well-formed',
    ],
  },
  {
    dir: '.config/fleet/oxlint-plugin/fleet',
    label: 'lint rule',
    gates: ['fleet-artifacts-are-complete'],
  },
]

const CANONICAL_PREFIX = 'template/base/'

/**
 * The path with a canonical `template/base/` prefix removed, so one table entry
 * matches an artifact authored in the wheelhouse and the same artifact
 * cascaded into a member.
 */
export function stripCanonicalPrefix(relPath: string): string {
  const normalized = relPath.replaceAll('\\', '/').replace(/^\.\//, '')
  return normalized.startsWith(CANONICAL_PREFIX)
    ? normalized.slice(CANONICAL_PREFIX.length)
    : normalized
}

/**
 * The group owning `relPath`, or undefined when the path is not an artifact.
 *
 * Matched on a whole path segment so `.claude/hooks/fleet-extras/x` cannot read
 * as a hook, and a bare directory path (no file under it) is not an artifact.
 */
export function groupForPath(relPath: string): ArtifactGateGroup | undefined {
  const scoped = stripCanonicalPrefix(relPath)
  for (let i = 0, { length } = ARTIFACT_GATE_GROUPS; i < length; i += 1) {
    const group = ARTIFACT_GATE_GROUPS[i]!
    if (scoped.startsWith(`${group.dir}/`)) {
      return group
    }
  }
  return undefined
}

/**
 * The gates governing `relPath`, or an empty list when it is not an artifact.
 */
export function gatesForPath(relPath: string): readonly string[] {
  return groupForPath(relPath)?.gates ?? []
}

/**
 * The artifact paths in a `git status --porcelain` capture.
 *
 * Reads the working tree rather than a session ledger: whatever is dirty is
 * what this turn would leave behind, which is the thing worth gating. Renames
 * (`R  old -> new`) report the DESTINATION, since that is the artifact that has
 * to be well-formed. Deletions are skipped — a removed artifact has no shape to
 * check, and its absence is what the registry gates catch.
 */
export function dirtyArtifactPaths(porcelain: string): string[] {
  const found = new Set<string>()
  const lines = porcelain.split(/\r?\n/)
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (line.length < 4) {
      continue
    }
    const status = line.slice(0, 2)
    if (status.includes('D')) {
      continue
    }
    const rest = line.slice(3)
    const arrow = rest.indexOf(' -> ')
    const target = arrow === -1 ? rest : rest.slice(arrow + 4)
    const unquoted = target.replace(/^"(.*)"$/, '$1')
    if (groupForPath(unquoted)) {
      found.add(unquoted)
    }
  }
  return sortedStrings([...found])
}

/**
 * Every gate to run for a `git status --porcelain` capture, deduped and sorted
 * so one gate covering two touched kinds runs once.
 */
export function gatesForPorcelain(porcelain: string): string[] {
  const gates = new Set<string>()
  const paths = dirtyArtifactPaths(porcelain)
  for (let i = 0, { length } = paths; i < length; i += 1) {
    for (const gate of gatesForPath(paths[i]!)) {
      gates.add(gate)
    }
  }
  return sortedStrings([...gates])
}
