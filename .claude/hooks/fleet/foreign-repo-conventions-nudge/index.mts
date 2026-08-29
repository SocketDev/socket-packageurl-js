#!/usr/bin/env node
// Claude Code PreToolUse hook — foreign-repo-conventions-nudge.
//
// Fires when an Edit/Write lands in a DIFFERENT repo than the one the session
// started in, and that repo carries its own instruction file. Names the file so
// the target repo's rules govern the edit instead of the originating repo's.
//
// The failure this prevents, seen 2026-08-20: a session rooted in a non-fleet
// repo edited a fleet member for hours while applying the ORIGIN repo's
// AGENTS.md. It refused `vi.mock` in a repo where mocks are the convention and
// `socket/prefer-mock-import` lints for their exact form, and reported a policy
// violation that did not exist. Nothing was wrong with the hooks: `scope:
// 'convention'` already resolves the ACTED-ON repo. What is loaded into the
// agent's context is the SESSION repo's instruction file, and nothing said the
// two had diverged.
//
// A nudge, not a guard: the edit is legitimate, only the rulebook in context is
// wrong. Blocking would stop cross-repo work that is routine here (a wheelhouse
// session cascading into a member, a fleet fix landed downstream).
//
// No `scope: 'convention'`: the rule decides WHICH conventions apply, so gating
// it on the target being fleet-managed would silence it in exactly the direction
// that misfired. No `mode` either, since this is not governance.
//
// Once per (session, target repo), so a session touching several repos hears
// about each and a long session is not nagged per edit.
//
// Fails open on any IO error: a hook bug must never stop an edit.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { actedOnPath } from '../_shared/fleet-context.mts'
import { defineHook, editGuard, notify, runHook } from '../_shared/guard.mts'
import { verdictLine } from '../_shared/verdict.mts'
import { resolveProjectPath } from '../_shared/paths.mts'
import { resolveRepoRoot } from '../_shared/repo-root.mts'
import { sortedStrings } from '../_shared/sorted-by.mts'

// The instruction files a repo can carry, CLAUDE.md first because it is the
// authoritative one in both shapes the fleet meets:
//
//   - A fleet repo tracks CLAUDE.md and GENERATES AGENTS.md as a symlink to it
//     (scripts/fleet/gen/harness-adapters.mts, a pointer file on Windows).
//     `/AGENTS.md` is gitignored, so a fresh clone may not carry it at all and
//     naming it would name a file the reader does not have.
//   - A non-fleet repo can be the inverse: CLAUDE.md is a one-line `@AGENTS.md`
//     include and AGENTS.md holds the text.
//
// Naming CLAUDE.md lands the reader on the rules in both, directly in the first
// and after one documented hop in the second. AGENTS.md stays as the fallback
// for a repo that carries it and no CLAUDE.md.
const INSTRUCTION_FILES: readonly string[] = ['CLAUDE.md', 'AGENTS.md']

const STORE_DIR = path.join('.cache', 'fleet', 'foreign-repo-conventions')

/**
 * The instruction file at `repoRoot`, or undefined when it carries none.
 *
 * A repo with no instruction file gets no nudge: the message's whole value is
 * naming the file to read, and "other rules apply, unspecified" is noise.
 */
export function instructionFileFor(repoRoot: string): string | undefined {
  for (let i = 0, { length } = INSTRUCTION_FILES; i < length; i += 1) {
    const name = INSTRUCTION_FILES[i]!
    if (existsSync(path.join(repoRoot, name))) {
      return name
    }
  }
  return undefined
}

/**
 * Whether `targetRoot` is a different repo than `sessionRoot`.
 *
 * Compared normalized so a Windows checkout, or a `/private`-prefixed macOS
 * temp path, does not read as divergent when it is the same tree.
 */
export function isForeignRepo(
  sessionRoot: string,
  targetRoot: string,
): boolean {
  return normalizePath(sessionRoot) !== normalizePath(targetRoot)
}

/**
 * Where the record of already-announced repos lives.
 */
export function storeFilePath(sessionRoot: string): string {
  const base = existsSync(sessionRoot) ? sessionRoot : os.tmpdir()
  return path.join(base, STORE_DIR, 'announced.json')
}

/**
 * The repos already announced. Empty on any read failure.
 */
export function readAnnounced(sessionRoot: string): Set<string> {
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(storeFilePath(sessionRoot), 'utf8'),
    )
    if (Array.isArray(parsed)) {
      const out = new Set<string>()
      for (const entry of parsed) {
        if (typeof entry === 'string') {
          out.add(entry)
        }
      }
      return out
    }
  } catch {
    // No store yet, or an unreadable one. Announcing again is the safe
    // direction: a duplicate line costs a line, a swallowed one costs the
    // wrong rulebook for the rest of the session.
  }
  return new Set()
}

/**
 * Record the announced set. Silent on any write failure.
 */
export function writeAnnounced(
  sessionRoot: string,
  announced: ReadonlySet<string>,
): void {
  try {
    const file = storeFilePath(sessionRoot)
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(
      file,
      `${JSON.stringify(sortedStrings([...announced]))}\n`,
      'utf8',
    )
  } catch {
    // A store we cannot write means the nudge repeats, which is the tolerable
    // failure, so it stays silent rather than surfacing as a hook error.
  }
}

/**
 * The nudge line for an edit crossing into `targetName`.
 *
 * Names both repos because "a different repo" is not actionable: the operator
 * needs to know which rulebook it just stopped being.
 */
export function foreignRepoMessage(
  sessionName: string,
  targetName: string,
  instructionFile: string,
): string {
  // Composed, not an array literal: the quiet-guards analyzer reads an
  // `[ … ].join()` structurally and counts a multi-line verdictLine call as
  // several entries whose first does not open with the hook name. The shape
  // itself is pinned by this module's specs instead.
  const head = verdictLine(
    'hint',
    'foreign-repo-conventions-nudge',
    `editing ${targetName}, session started in ${sessionName} - different repo, different rules.`,
  )
  const fix = `Fix: follow ${targetName}/${instructionFile}; ${sessionName}'s conventions do not govern this edit.`
  return `${head}\n${fix}`
}

export const check = editGuard((_filePath, _content, payload) => {
  const sessionRoot = resolveRepoRoot(resolveProjectPath(payload?.cwd))
  const targetRoot = resolveRepoRoot(actedOnPath(payload))
  if (!isForeignRepo(sessionRoot, targetRoot)) {
    return undefined
  }
  const instructionFile = instructionFileFor(targetRoot)
  if (!instructionFile) {
    return undefined
  }
  const announced = readAnnounced(sessionRoot)
  const key = normalizePath(targetRoot)
  if (announced.has(key)) {
    return undefined
  }
  announced.add(key)
  writeAnnounced(sessionRoot, announced)
  return notify(
    foreignRepoMessage(
      path.basename(sessionRoot),
      path.basename(targetRoot),
      instructionFile,
    ),
  )
})

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'MultiEdit', 'Write'],
  type: 'nudge',
})
void runHook(hook, import.meta.url)
