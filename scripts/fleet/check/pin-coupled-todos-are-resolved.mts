#!/usr/bin/env node
/*
 * @file Gate: a `TODO(<pkg>@<version>)` marker must be gone by the time the pin
 *   reaches that version.
 *
 *   A comment that says "do this when the pin moves" is not enforcement. The
 *   pin moves in a different change from the one that wrote the comment, often
 *   months later, and nothing reads the comment at that moment. This makes the
 *   marker law: silent while the pin is below the named version, red the moment
 *   the pin reaches it, naming every marker still outstanding.
 *
 *   The motivating case is a marker that removes working behavior if honored
 *   naively. `scripts/fleet/_shared/git-exec.mts` becomes a thin re-export of
 *   the lib's own `git/exec` at `lib@7.0.0`, but that module throws on a locked
 *   index without retrying, so collapsing it drops the retry and restores a
 *   hard failure — and the re-export type-checks cleanly while doing it. A gate
 *   that fires exactly at the cutover is the only thing that catches that.
 *
 *   Marker syntax: `TODO(<pkg>@<semver>)`, where `<pkg>` is a key this check
 *   knows how to resolve to a pinned version. Unknown package keys are reported
 *   rather than ignored, so a typo in a marker cannot make it unenforceable.
 *
 *   Exit codes: 0 — every marker's pin is still below its target, or none
 *   exist; 1 — a marker is due, or names a package this cannot resolve.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { gte } from '@socketsecurity/lib-stable/versions/compare'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { gitSync } from '../_shared/git-exec.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import { REPO_ROOT } from '../paths.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

const WORKSPACE_PIN_FILE = path.join(
  '.config',
  'fleet',
  'pnpm-workspace.fleet.yaml',
)

// `TODO(lib@7.0.0)` and friends. The package key is short by design: a marker
// is read in a code comment, so `lib` beats the full scoped specifier, and
// PIN_SOURCES is what turns the short key back into a real pin.
const MARKER_RE = /TODO\(([a-z][\w.-]*)@(\d+\.\d+\.\d+)\)/g

/**
 * How to read the currently pinned version for each package key a marker may
 * name. Returning undefined means "cannot resolve", which is a failure rather
 * than a pass: an unresolvable marker is one nobody will ever be told about.
 */
export const PIN_SOURCES: Readonly<
  Record<string, (repoRoot: string) => string | undefined>
> = Object.freeze({
  __proto__: null,
  lib: readLibPin,
} as unknown as Record<string, (repoRoot: string) => string | undefined>)

/**
 * The `@socketsecurity/lib` version this repo pins, from the fleet workspace
 * catalog. Reads the catalog entry rather than the installed tree so the check
 * describes the pin under review, not whatever a stale `node_modules` holds.
 */
export function readLibPin(repoRoot: string): string | undefined {
  const pinFile = path.join(repoRoot, WORKSPACE_PIN_FILE)
  if (!existsSync(pinFile)) {
    return undefined
  }
  let body: string
  try {
    body = readFileSync(pinFile, 'utf8')
  } catch {
    return undefined
  }
  // The alias spelling carries the version too, and both must agree; the
  // lockstep between them is another check's business, so either answers here.
  return (
    /'@socketsecurity\/lib':\s*(\d+\.\d+\.\d+)/.exec(body)?.[1] ??
    /npm:@socketsecurity\/lib@(\d+\.\d+\.\d+)/.exec(body)?.[1]
  )
}

export interface PinTodo {
  readonly file: string
  readonly line: number
  readonly pkg: string
  readonly target: string
}

/**
 * Every `TODO(<pkg>@<version>)` marker in `text`, with 1-based line numbers.
 */
export function findPinTodos(file: string, text: string): PinTodo[] {
  const found: PinTodo[] = []
  const lines = text.split(/\r?\n/)
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    // A fresh lastIndex per line: the regex is module-scoped and global.
    MARKER_RE.lastIndex = 0
    let match = MARKER_RE.exec(line)
    while (match) {
      found.push({ file, line: i + 1, pkg: match[1]!, target: match[2]! })
      match = MARKER_RE.exec(line)
    }
  }
  return found
}

/**
 * The tracked files to scan. Uses the git index rather than a directory walk so
 * a build output, a vendored tree, or an untracked scratch file cannot make the
 * gate red.
 */
export function scannableFiles(repoRoot: string): string[] {
  const listed = gitSync(['ls-files'], { cwd: repoRoot })
  return String(listed.stdout ?? '')
    .split(/\r?\n/)
    .filter(file =>
      /\.(?:cjs|cts|js|json|jsonc|mjs|mts|ts|yaml|yml)$/.test(file),
    )
}

export interface DueTodo extends PinTodo {
  readonly pinned: string
}

/**
 * Split markers into the ones whose pin has arrived and the ones naming a
 * package that cannot be resolved.
 */
export function classifyTodos(
  todos: readonly PinTodo[],
  repoRoot: string,
): { due: DueTodo[]; unresolvable: PinTodo[] } {
  const due: DueTodo[] = []
  const unresolvable: PinTodo[] = []
  const pinCache = new Map<string, string | undefined>()
  for (const todo of todos) {
    if (!Object.hasOwn(PIN_SOURCES, todo.pkg)) {
      unresolvable.push(todo)
      continue
    }
    if (!pinCache.has(todo.pkg)) {
      pinCache.set(todo.pkg, PIN_SOURCES[todo.pkg]!(repoRoot))
    }
    const pinned = pinCache.get(todo.pkg)
    if (!pinned) {
      unresolvable.push(todo)
      continue
    }
    if (gte(pinned, todo.target)) {
      due.push({ ...todo, pinned })
    }
  }
  return { due, unresolvable }
}

export async function main(): Promise<void> {
  const isQuiet = process.argv.includes('--quiet')
  const todos: PinTodo[] = []
  for (const file of scannableFiles(REPO_ROOT)) {
    let text: string
    try {
      text = readFileSync(path.join(REPO_ROOT, file), 'utf8')
    } catch {
      continue
    }
    if (!text.includes('TODO(')) {
      continue
    }
    todos.push(...findPinTodos(file, text))
  }
  const { due, unresolvable } = classifyTodos(todos, REPO_ROOT)
  if (unresolvable.length) {
    logger.fail(
      `[pin-coupled-todos-are-resolved] ${unresolvable.length} marker(s) name a package this cannot resolve.`,
    )
    logger.group()
    for (const todo of unresolvable) {
      logger.error(`${todo.file}:${todo.line} TODO(${todo.pkg}@${todo.target})`)
    }
    logger.error(
      `Fix: use a package key PIN_SOURCES knows (${Object.keys(PIN_SOURCES).join(', ')}), or add a reader for this one. An unresolvable marker is never enforced.`,
    )
    logger.groupEnd()
    process.exitCode = 1
    return
  }
  if (due.length) {
    logger.fail(
      `[pin-coupled-todos-are-resolved] ${due.length} marker(s) are due: the pin has reached the version they named.`,
    )
    logger.group()
    for (const todo of due) {
      logger.error(
        `${todo.file}:${todo.line} TODO(${todo.pkg}@${todo.target}) — pinned at ${todo.pinned}`,
      )
    }
    logger.error(
      'Fix: do what each marker says, then delete it. Read the marker first — one of them removes working behavior if honored without porting its replacement upstream.',
    )
    logger.groupEnd()
    process.exitCode = 1
    return
  }
  if (!isQuiet) {
    logger.log(
      `[pin-coupled-todos-are-resolved] ok — ${todos.length} pin-coupled marker(s), none due yet`,
    )
  }
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'checks every TODO(<pkg>@<version>) marker is gone by the time the pin reaches that version',
  help: `Usage: node scripts/fleet/check/pin-coupled-todos-are-resolved.mts [flags]

  --quiet  silent on clean`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
