/**
 * @file Claude Code PreToolUse hook — shared-index-add-nudge. NOTIFIES when a
 *   `git add` is about to build a commit on top of paths someone else already
 *   staged.
 *   The index is shared. In a checkout two agents work in, one session's
 *   `git add <my paths>` does not produce an index holding only its paths — it
 *   holds whatever the co-session staged too, and the next `git commit` sweeps
 *   the lot under one message. Live example from this repo: a `git add` of six
 *   fleet paths landed in an index that already carried another session's
 *   `package.json`, `pnpm-lock.yaml` and a statusline entry point, all staged
 *   minutes earlier and none of them mine to commit.
 *   The sanctioned path is `scripts/fleet/commit-paths.mts`, which commits
 *   exactly the paths it is given through an ISOLATED index, so a co-session's
 *   staged work is never swept in and the shared lock is never contended.
 *   A NUDGE, not a block. `git add` is the right call constantly — in a
 *   single-actor checkout, for a staged-hunk review, for `git add -p`. What is
 *   worth one line of warning is the specific case the author cannot see from
 *   the command they typed: the index ALREADY holds paths this add does not
 *   name. That is read from git, not guessed, so a clean index says nothing at
 *   all.
 *   Fails open on any git or parse error — a nudge that cannot read the index
 *   must not interrupt a Bash call it has no opinion about.
 */

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { bashGuard, defineHook, notify, runHook } from '../_shared/guard.mts'
import { resolveProjectPath } from '../_shared/paths.mts'
import { parseCommands } from '../_shared/shell-command.mts'
import { verdictLine } from '../_shared/verdict.mts'

/**
 * Flags that make `git add` sweep the whole tree rather than named paths.
 */
const SWEEPING_FLAGS = new Set(['--all', '--update', '-A', '-u'])

/**
 * How many foreign paths to name before summarizing the rest.
 */
const SHOWN_PATHS = 5

/**
 * `git add` pathspecs in `command`, or undefined when it contains no `git add`.
 * An empty array means the add named no paths.
 *
 * Tokenized through the shared quote-aware parser so a quoted commit message
 * mentioning "git add" in prose stays one token and never reads as an
 * invocation.
 */
export function gitAddPathspecs(command: string): string[] | undefined {
  let found: string[] | undefined
  for (const cmd of parseCommands(command)) {
    const tokens = [cmd.binary, ...cmd.args].filter((token): token is string =>
      Boolean(token),
    )
    const at = tokens.indexOf('git')
    if (at === -1 || tokens[at + 1] !== 'add') {
      continue
    }
    const specs: string[] = []
    for (let i = at + 2, { length } = tokens; i < length; i += 1) {
      const token = tokens[i]!
      // A sweeping flag names no path but covers every path, which the caller
      // reads as "everything is named".
      if (SWEEPING_FLAGS.has(token)) {
        specs.push('.')
        continue
      }
      if (token.startsWith('-')) {
        continue
      }
      specs.push(token)
    }
    found = [...(found ?? []), ...specs]
  }
  return found
}

/**
 * True when `pathspec` covers `file`. Deliberately conservative — a pathspec
 * this cannot prove covers the file counts as NOT covering it, which at worst
 * emits a nudge nobody needed. The inverse error is the expensive one: reading
 * a foreign staged path as covered means staying silent in exactly the case
 * this exists for.
 */
export function pathspecCovers(pathspec: string, file: string): boolean {
  if (pathspec === ':/' || pathspec === '.' || pathspec === '*') {
    return true
  }
  const spec = pathspec.replace(/\/+$/, '')
  return file === spec || file.startsWith(`${spec}/`)
}

/**
 * Staged paths this add does not name — the co-session's work that a following
 * `git commit` would sweep in. Pure over the two lists, so the rule is
 * testable without an index.
 */
export function foreignStagedPaths(
  staged: readonly string[],
  pathspecs: readonly string[],
): string[] {
  const out: string[] = []
  for (let i = 0, { length } = staged; i < length; i += 1) {
    const file = staged[i]!
    let covered = false
    for (let j = 0, { length: specCount } = pathspecs; j < specCount; j += 1) {
      if (pathspecCovers(pathspecs[j]!, file)) {
        covered = true
        break
      }
    }
    if (!covered) {
      out.push(file)
    }
  }
  return out
}

/**
 * Paths already staged in the index, or an empty list when git cannot answer.
 */
export function readStagedPaths(cwd: string): string[] {
  try {
    const result = spawnSync('git', ['diff', '--cached', '--name-only'], {
      cwd,
      stdioString: true,
    })
    if (result.status !== 0) {
      return []
    }
    return String(result.stdout ?? '')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

export function formatNudge(foreign: readonly string[]): string {
  const shown = foreign.slice(0, SHOWN_PATHS).join(', ')
  const more =
    foreign.length > SHOWN_PATHS
      ? `, +${foreign.length - SHOWN_PATHS} more`
      : ''
  return `${[
    verdictLine(
      'warn',
      'shared-index-add-nudge',
      `the index already holds ${foreign.length} staged path(s) this add does not name (${shown}${more}) - a following \`git commit\` would sweep them into your commit.`,
    ),
    'Fix: commit named paths through an isolated index instead - `node scripts/fleet/commit-paths.mts -m <msg> <path>…`. Nothing to do if that staged work is yours.',
  ].join('\n')}\n`
}

export const hook = defineHook({
  check: bashGuard((command, payload) => {
    const pathspecs = gitAddPathspecs(command)
    if (pathspecs === undefined) {
      return undefined
    }
    // resolveProjectPath, never process.cwd(): a hook's cwd is whatever the
    // tool call happened to run in, so reading the index from it would ask the
    // wrong repo in a worktree or a nested package.
    const cwd = resolveProjectPath(
      typeof payload?.cwd === 'string' ? payload.cwd : undefined,
    )
    const foreign = foreignStagedPaths(readStagedPaths(cwd), pathspecs)
    if (foreign.length === 0) {
      return undefined
    }
    return notify(formatNudge(foreign))
  }),
  event: 'PreToolUse',
  global: true,
  matcher: ['Bash'],
  type: 'nudge',
})

void runHook(hook, import.meta.url)
