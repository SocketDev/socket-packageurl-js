#!/usr/bin/env node
/**
 * @file Claude Code PreToolUse hook — corepack-guard. BLOCKS a Bash command
 *   that invokes `corepack`, in any subcommand form: `corepack prepare`,
 *   `corepack enable`, `corepack pnpm`, and so on. Why: pnpm changes its own
 *   version without corepack. `pnpm with <version> <args>` runs one invocation
 *   at a specific version cached in the global virtual store, and
 *   `pnpm self-update` bumps the shim itself. The wheelhouse ships its own
 *   pnpm shim and pins the version in the manifest, so corepack bypasses both
 *   the pin and the shim, and the fleet does not install latest that way.
 *   Detection tokenizes at command position via the shared `parseCommands`
 *   parser, so a quoted argument such as a `git commit -m 'mentions corepack
 *   in prose'` stays ONE token and never false-matches the name; only an
 *   actual invocation, bare or through `find -exec` / `xargs`, tokenizes the
 *   name as its own word. Bypass: `Allow corepack bypass` typed verbatim in a
 *   recent user turn, for the rare real one-off. Fails open on parse/payload
 *   errors, since a guard bug must not block every Bash call.
 */

import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import { parseCommands } from '../_shared/shell-command.mts'
import { verdictLine } from '../_shared/verdict.mts'

const COREPACK_NAMES = new Set(['corepack'])

/**
 * Return a human-readable reason when `command` invokes corepack, else
 * undefined. Pure, exported for tests. Matches `corepack` only as a command
 * BINARY, not as an argument, so `grep corepack` / `echo corepack` / a commit
 * message that mentions corepack never false-matches. Each segment's binary
 * comes from the shared quote-aware `parseCommands` parser, so a quoted
 * string, a commit message, or a grep pattern is one token and can never be
 * mistaken for a command-position word.
 */
export function detectCorepack(command: string): string | undefined {
  for (const cmd of parseCommands(command)) {
    if (cmd.binary && COREPACK_NAMES.has(cmd.binary)) {
      return '`corepack` bypasses the pnpm manifest pin and the wheelhouse shim'
    }
  }
  return undefined
}

export function formatBlock(reason: string): string {
  return (
    [
      verdictLine('block', 'corepack-guard', `${reason}.`),
      'Fix: `pnpm with <version> <args...>` runs one pinned invocation; `pnpm self-update` bumps the shim.',
      '',
    ].join('\n') + '\n'
  )
}

export const hook = defineHook({
  bypass: ['corepack'],
  check: bashGuard((command, _payload) => {
    const reason = detectCorepack(command)
    if (!reason) {
      return undefined
    }
    return block(formatBlock(reason))
  }),
  event: 'PreToolUse',
  global: true,
  matcher: ['Bash'],
  type: 'guard',
})

void runHook(hook, import.meta.url)
