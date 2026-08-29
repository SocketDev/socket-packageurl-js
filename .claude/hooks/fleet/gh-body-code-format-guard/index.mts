#!/usr/bin/env node
// Claude Code PreToolUse hook — gh-body-code-format-guard.
//
// Blocks a `gh` invocation whose `--body` / `--body=` / `-f body=` /
// `-F body=` / `--field body=` / `--raw-field body=` argument carries a CLEAR
// inline-code backtick mistake — the shell-escaping artifact at the SOURCE of
// the pnpm#13981 bug. There an over-escaped `\`foo\`` inside a single-quoted
// `gh ... --body '...'` posted a LITERAL backtick to the comment instead of
// inline code, and the reply narration was clean, so a Stop hook scanning only
// reply text would have missed it. This guard sees the command string BEFORE
// it runs and flags the mangling at the source.
//
// It runs the SAME backtick-mistake checks as `reply-code-format-guard` on the
// extracted body string, via the shared `_shared/code-format-parser.mts` state
// machine: a backslash-escaped backtick, a doubled-backtick span around simple
// content, or empty/back-to-back/unbalanced backticks. A fenced ``` ``` block
// inside the body is opaque and exempt.
//
// Reads the command through the shell-quote-backed AST parser
// (`commandsFor(command, 'gh')`), never a raw regex, so `&&` chains, quoting,
// and `$(…)` substitution are handled and a literal "gh" inside a grep string
// cannot false-fire. The parsed args are already dequoted, so a single-quoted
// `'see \`foo\`'` yields the literal body `see \`foo\`` (backslash preserved →
// flagged) while a double-quoted `"see \`foo\`"` yields `see `foo`` (shell
// consumed the backslash → clean) — matching what actually gets posted.
//
// Fails open: no `gh` command, no body argument, `--body-file` (file content
// not visible), or any parse error → allow. No bypass; fix the backticks.

import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import { findCodeFormatHits } from '../_shared/code-format-parser.mts'
import type { CodeFormatHit } from '../_shared/code-format-parser.mts'
import { commandsFor } from '../_shared/shell-command.mts'
import type { Command } from '../_shared/shell-command.mts'

// Pre-flight triggers: the dispatcher imports this guard only when one of
// these tokens appears in the raw payload. Every `gh ... --body` command
// carries `gh` plus a body-flag spelling, so this is the necessary substring
// gate before the shell parser runs.
export const triggers: readonly string[] = [
  'gh',
  '--body',
  '--body-file',
  '--field',
  '--raw-field',
]

const FIX_HINT =
  'use single backticks `foo` for inline code; only double ``foo`` when the content itself contains a backtick; never backslash-escape backticks in code spans'

/**
 * Extract the body argument value strings from one parsed `gh` segment's args.
 * Recognizes `--body <v>`, `--body=<v>`, `-f body=<v>`, `-F body=<v>`,
 * `--field body=<v>`, `--raw-field body=<v>`. `--body-file` reads from a file
 * whose content is not visible in the command, so it is skipped. A `-F`/
 * `--raw-field` value of `@<path>` is likewise a file and is skipped.
 */
export function extractGhBodyValues(args: readonly string[]): string[] {
  const out: string[] = []
  for (let i = 0, { length } = args; i < length; i += 1) {
    const a = args[i]!
    if (a === '--body') {
      const v = args[i + 1]
      if (v !== undefined) {
        out.push(v)
      }
    } else if (a.startsWith('--body=')) {
      out.push(a.slice('--body='.length))
    } else if (a === '--body-file' || a.startsWith('--body-file=')) {
      // File content not visible — cannot scan; fail open for this arg.
      continue
    } else if (
      a === '--field' ||
      a === '--raw-field' ||
      a === '-f' ||
      a === '-F'
    ) {
      const v = args[i + 1]
      if (v !== undefined && v.startsWith('body=')) {
        const val = v.slice('body='.length)
        // `-F body=@file` reads from a file — not visible, skip.
        if (!val.startsWith('@')) {
          out.push(val)
        }
      }
    }
  }
  return out
}

/**
 * Collect every body-argument backtick mistake across all `gh` segments of a
 * command string. Returns the hits (empty when the command has no `gh` body
 * to scan or every body is clean).
 */
export function findGhBodyHits(command: string): CodeFormatHit[] {
  const hits: CodeFormatHit[] = []
  for (const c of commandsFor(command, 'gh')) {
    scanGhSegment(c, hits)
  }
  return hits
}

function scanGhSegment(c: Command, hits: CodeFormatHit[]): void {
  for (const body of extractGhBodyValues(c.args)) {
    for (const hit of findCodeFormatHits(body)) {
      hits.push(hit)
    }
  }
}

export function blockMessage(hits: readonly CodeFormatHit[]): string {
  const first = hits[0]!
  const more = hits.length > 1 ? ` (+${hits.length - 1} more)` : ''
  return [
    `gh-body-code-format-guard: backtick mistake in a body arg - posts mangled inline code.`,
    `Saw: delete "${first.span}" - …${first.snippet}…${more}`,
    `Fix: ${FIX_HINT}.`,
  ].join('\n')
}

export const check = bashGuard((command): GuardResult => {
  const hits = findGhBodyHits(command)
  if (!hits.length) {
    return undefined
  }
  return block(blockMessage(hits))
})

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  triggers,
  type: 'guard',
})

void runHook(hook, import.meta.url)
