// Claude Code PreToolUse hook — sabotage-target-guard.
//
// A sabotage proof only counts when the PRODUCTION code is reverted. Mutating
// the TEST and watching it fail proves the assertion can fail; it proves
// nothing about whether the test is wired to the behaviour under test.
//
// This blocks the specific shape that gets it wrong: a command that announces
// sabotage AND touches only test files. If you are sabotaging correctly, the
// command names the production file, and the hook stands down.
//
// WHY THIS IS A GATE AND NOT A NOTE. A regression test for a Perry build-cache
// fix compared two fingerprints by hand and never called the function holding
// the fix. It passed with that fix fully reverted. It had been declared
// "sabotage-verified" — by mutating the test's own comparison. A reviewer
// caught it. Both the discipline and the failure were already written down;
// writing them down is what did not work.
//
// Deliberately narrow, because a false block is worse than a missed one here:
// it fires only when a sabotage marker and a test path are both present and no
// non-test source file is named.
//
// TWO ARMS, because one shape cannot be decided from the path alone.
//
//   1. BLOCK — the command names only SEPARATE test files. Unambiguous.
//   2. NOTIFY — the command names a source file that holds its own
//      `#[cfg(test)] mod tests`. In Rust the production function and its unit
//      tests share a file, so the path proves nothing about which half was
//      edited. That is precisely the case that shipped, so it gets asked about
//      rather than waved through — but it is a question, not a block, because
//      the edit is just as likely to be the correct one.
//
// Bypass: `Allow sabotage-target bypass` typed verbatim in a recent user turn.

import {
  bashGuard,
  block,
  defineHook,
  notify,
  runHook,
} from '../_shared/guard.mts'
import { readFileSync } from 'node:fs'

// The announcement. Matched case-insensitively as a whole word so ordinary
// prose about a "sabotaged build" in a commit message body does not trip it,
// while the `SABOTAGE:` marker convention does.
const SABOTAGE_RE = /\bsabotag(?:e|ed|ing)\b/i

// Paths that are TEST code. Rust (`foo_tests.rs`, `tests/bar.rs`,
// `mod tests`), JS/TS (`x.test.mts`, `__tests__/`), and Python (`test_x.py`).
const TEST_PATH_RE =
  /(?:^|[\s'"`(/=])[\w./-]*(?:\.test\.[cm]?[jt]sx?|\/__tests__\/|\/tests?\/|\btest_[\w-]+\.(?:mts|py|ts)|_test\.py|_tests?\.rs)/

// Paths that are PRODUCTION code — the thing a real sabotage edits. A command
// naming one of these is doing it right, whatever else it touches.
const PROD_PATH_RE =
  /(?:^|[\s'"`(/=])[\w./-]*\.(?:rs|mts|ts|tsx|js|mjs|cjs|py|go|c|cc|cpp|h|hpp)\b/

/**
 * Every production-looking path in the command that is not itself a test path.
 */
function namesNonTestSource(command: string): boolean {
  for (const match of command.matchAll(new RegExp(PROD_PATH_RE, 'g'))) {
    const candidate = match[0].trim().replace(/^['"`(=]/, '')
    if (!TEST_PATH_RE.test(candidate)) {
      return true
    }
  }
  return false
}

/**
 * Source files named by the command that carry an in-file test module.
 */
function filesWithInlineTests(command: string): string[] {
  const found: string[] = []
  for (const match of command.matchAll(new RegExp(PROD_PATH_RE, 'g'))) {
    const candidate = match[0].trim().replace(/^['"`(=]/, '')
    if (TEST_PATH_RE.test(candidate)) {
      continue
    }
    // node builtin rather than a package helper: this file is copied into a
    // home-directory hook tree with no node_modules to resolve from, and a
    // guard that throws on an unresolvable import fails closed on every Bash
    // call. Unreadable path -> skip, never throw.
    let text = ''
    try {
      text = readFileSync(candidate, 'utf8')
    } catch {
      continue
    }
    if (/#\[cfg\(test\)\]|\bmod tests\b/.test(text)) {
      found.push(candidate)
    }
  }
  return found
}

function formatNotify(files: string[]): string {
  return `sabotage-target-guard: ${files.join(', ')} holds its own test module - only reverting the PRODUCTION half and watching the test go red proves anything.`
}

function formatBlock(): string {
  return [
    'sabotage-target-guard: this sabotages the TEST, which proves nothing - a test that never calls the fixed function passes with the fix reverted.',
    'Fix: revert the PRODUCTION change instead and watch this test go red.',
  ].join('\n')
}

export const hook = defineHook({
  bypass: ['sabotage-target'],
  check: bashGuard(command => {
    if (!command.trim() || !SABOTAGE_RE.test(command)) {
      return undefined
    }
    // Order matters, and an earlier version got it wrong in a way worth
    // recording: gating the whole hook on a test path in the COMMAND excluded
    // the in-file case by construction — the exact shape this guard exists for
    // never reached the arm meant to catch it.
    //
    // A real source file is named: the edit is probably the production half,
    // which is correct. Say something only when that file carries its own test
    // module, where the path cannot tell the two halves apart.
    if (namesNonTestSource(command)) {
      const inline = filesWithInlineTests(command)
      return inline.length ? notify(formatNotify(inline)) : undefined
    }
    // Only test files named. Unambiguous, and proves nothing.
    if (TEST_PATH_RE.test(command)) {
      return block(formatBlock())
    }
    return undefined
  }),
  event: 'PreToolUse',
  matcher: ['Bash'],
  type: 'guard',
})

void runHook(hook, import.meta.url)
