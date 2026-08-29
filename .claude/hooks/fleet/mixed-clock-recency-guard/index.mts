#!/usr/bin/env node
// Claude Code PreToolUse hook — mixed-clock-recency-guard.
//
// Blocks a Bash command that judges how recently a file was written by
// comparing a LOCAL-time clock against a UTC one. The shape:
//
//   echo "now=$(date -u +%H:%M:%S)"; stat -f '%Sm' -t '%H:%M:%S' <path>
//
// `stat` prints the mtime in local time. `date -u` prints UTC. Subtracting one
// from the other silently adds the machine's UTC offset to every age, so a file
// written seconds ago reads as hours old.
//
// The failure is not a wrong number, it is a wrong DECISION. The active-edits
// rule says a path another live actor wrote within 5 minutes is blocked. An age
// inflated by the offset turns every live path into an abandoned one, so the
// rule that exists to prevent a write-write collision waves it through.
//
// Measured incident: on a machine at UTC-7, a session compared `stat` against
// `date -u` and concluded three separate times that files touched seconds
// earlier were "7 hours cold, no live actor". Acting on that it read a module
// mid-write and chased a `checkOverrideDeclarations is not a function` that was
// only a half-saved file, adapted its own code to a signature that changed
// again a minute later, and had staged paths swept into another actor's commit
// more than once. Every one of those followed from the offset.
//
// The correct answers already exist, which is why this blocks rather than
// nudges:
//
//   * Ledger-backed, and what the active-edits rule is defined in terms of:
//     `_shared/active-edits-ledger.mts` — `attributeDirtyPath` / `lookupPath`
//     answer "is another live actor on this path" against COLLISION_WINDOW_MS.
//
//   * One clock, when a raw age is genuinely what is wanted: `Date.now()` and
//     `statSync(p).mtimeMs` are both epoch milliseconds, so no timezone enters
//     the arithmetic at all.
//
// Bypass: `Allow mixed-clock bypass`, for the case where the two clocks are
// genuinely unrelated — a UTC timestamp for a log line beside an unrelated
// `stat` of a fixture — which the matcher cannot tell apart from a comparison.
//
// Reads a Claude Code PreToolUse JSON payload from stdin:
//   { "tool_name": "Bash", "tool_input": { "command": "..." }, ... }

import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

import type { GuardResult } from '../_shared/guard.mts'
import { verdictLine } from '../_shared/verdict.mts'

export const BYPASS_PHRASE = 'Allow mixed-clock bypass'
// Pre-flight trigger for the dispatcher: every block path requires a formatted
// `stat` mtime read, so a command with no `stat` can never block — skip
// importing this guard for it.
export const triggers: readonly string[] = ['stat']

// `stat` asking for a FORMATTED mtime. BSD spells it `-f '%Sm'`; GNU spells it
// `-c '%y'` or `--format=%y`. All three print local time. A numeric epoch mtime
// (`%m`, `%Y`) is deliberately exempt: epoch math is the correct form this
// guard points callers at, so flagging it would fight the fix.
const LOCAL_STAT_RE = /\bstat\b[^\n|;]*(?:%Sm|%y\b|--format=[^\n|;]*%y)/

// A UTC clock read anywhere in the same command.
const UTC_CLOCK_RE = /\bdate\b[^\n|;]*\s-u\b|\bdate\s+--utc\b/

/**
 * True when one command both formats an mtime in local time and reads a UTC
 * clock. Pure, so the matcher is testable without a hook payload.
 */
export function comparesMixedClocks(command: string): boolean {
  return LOCAL_STAT_RE.test(command) && UTC_CLOCK_RE.test(command)
}

export const check = bashGuard((command, payload): GuardResult => {
  if (!comparesMixedClocks(command)) {
    return undefined
  }
  if (bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)) {
    return undefined
  }
  return block(
    [
      verdictLine(
        'block',
        'mixed-clock-recency-guard',
        'a LOCAL-time `stat` mtime compared against `date -u` (UTC) inflates the age by the machine offset - a live path reads as abandoned.',
      ),
      `Fix: use _shared/active-edits-ledger.mts (attributeDirtyPath / lookupPath vs COLLISION_WINDOW_MS), or keep both sides epoch ms (\`Date.now() - statSync(p).mtimeMs\`). Bypass (user types verbatim): ${BYPASS_PHRASE}`,
      '',
    ].join('\n'),
  )
})

export const hook = defineHook({
  bypass: ['mixed-clock'],
  bypassMode: 'manual',
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  triggers,
  type: 'guard',
})
void runHook(hook, import.meta.url)
