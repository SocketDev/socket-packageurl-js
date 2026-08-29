#!/usr/bin/env node
// Claude Code PreToolUse hook — config-refs-are-segregated-at-edit.
//
// BLOCKS source that constructs a LOOSE `.config/<file>.{json,yaml,yml,toml}`
// path — either a string literal (`'.config/lockstep.json'`) or a path.join
// pair (`path.join(x, '.config', 'lockstep.json')`). `.config/` is segregated:
// the segment after `.config` MUST be `repo` (repo-owned) or `fleet`
// (fleet-identical). A loose reference is legacy back-compat for a config we've
// already relocated 100% — there is no transient to fall back for, so point at
// the one canonical home instead of adding a fallback branch.
//
// Config DATA only (.json/.yaml/.yml/.toml); code configs are exempt. Bypass:
// `Allow loose-config-ref bypass` for a genuinely external/loose config. Fails
// open on hook bugs (exit 0 + stderr log).
//
// Rule: docs/agents.md/fleet/config-segregation.md.

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { isFleetTarget } from '../_shared/fleet-context.mts'
import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'

const EXT = '(?:json|ya?ml|toml)'

// A `.config/<file>.<ext>` reference where the segment after `.config/` is NOT
// `repo/` or `fleet/`.
const LOOSE_LITERAL_RE =
  // oxlint-disable-next-line socket/require-regex-comment -- described above.
  new RegExp(`\\.config/(?!repo/|fleet/)[A-Za-z0-9._-]+\\.${EXT}\\b`)

// A `path.join(…, '.config', '<file>.<ext>')` pair — the segregated forms
// interpose `'repo'`/`'fleet'`, so a config-ext directly after `'.config'` is
// loose.
const LOOSE_JOIN_RE =
  // oxlint-disable-next-line socket/require-regex-comment -- described above.
  new RegExp(
    `['"\`]\\.config['"\`]\\s*,\\s*['"\`][A-Za-z0-9._-]+\\.${EXT}['"\`]`,
  )

/**
 * The two loose shapes, exported so the commit-time gate
 * (scripts/fleet/check/config-refs-are-segregated-at-commit.mts) matches
 * exactly what this hook blocks at the keystroke. One matcher, two surfaces.
 */
export const LOOSE_CONFIG_PATTERNS: readonly RegExp[] = [
  LOOSE_LITERAL_RE,
  LOOSE_JOIN_RE,
]

/**
 * The per-line escape the paired gate honors, kept here so the keystroke and
 * the commit agree about what is allowed: a migration READ that probes the
 * legacy location on a member that has not moved its config yet.
 */
const ALLOW_MARKER_RE = /loose-config-ref:\s*allow\b/

export function detectsLooseConfigRef(content: string): boolean {
  const lines = content.split(/\r?\n/)
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (ALLOW_MARKER_RE.test(line)) {
      continue
    }
    if (LOOSE_LITERAL_RE.test(line) || LOOSE_JOIN_RE.test(line)) {
      return true
    }
  }
  return false
}

/**
 * Files whose job is naming the loose shape, so they carry it as an example:
 * this guard, the commit-time gate, the burn-down list, and their tests. Kept
 * in lockstep with the gate SELF_REFERENTIAL set.
 */
export const SELF_REFERENTIAL: readonly string[] = [
  'config-refs-are-segregated-at-commit',
  'loose-config-ref-burn-down',
  'config-refs-are-segregated-at-edit',
]

export function emitBlock(filePath: string): string {
  return [
    'config-refs-are-segregated-at-edit: this builds a loose `.config/<file>` path - .config/ is segregated into `.config/repo/` or `.config/fleet/`.',
    `Where: ${filePath}`,
    'Fix: point at `.config/repo/<file>` or `.config/fleet/<file>` instead of the loose path; do not add a fallback branch.',
  ].join('\n')
}

export const check = editGuard((filePath, content, payload) => {
  const norm = normalizePath(filePath)
  // Source files only. Every file whose job is NAMING this shape carries it as
  // an example: this guard, the commit-time gate that scans for it, the
  // burn-down list recording the debt, and their tests. The gate keeps the same
  // set, so the two surfaces exempt the same files.
  if (
    !/\.(?:cjs|cts|js|mjs|mts|ts)$/.test(norm) ||
    SELF_REFERENTIAL.some(name => norm.includes(name))
  ) {
    return undefined
  }
  if (!content || !detectsLooseConfigRef(content)) {
    return undefined
  }
  if (!isFleetTarget(payload)) {
    return undefined
  }
  return block(emitBlock(filePath))
})

export const hook = defineHook({
  bypass: ['loose-config-ref'],
  bypassOptional: true,
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'MultiEdit', 'Write'],
  type: 'guard',
})

void runHook(hook, import.meta.url)
