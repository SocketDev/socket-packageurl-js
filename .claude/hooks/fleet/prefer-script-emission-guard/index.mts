#!/usr/bin/env node
// Claude Code Stop / PostToolUse hook — prefer-script-emission-guard.
//
// The EMISSION-side twin of the raw-command guards (no-raw-gh-auth-login-guard,
// no-direct-linter-guard): blocks a reply that tells the OPERATOR to run a raw
// command the repo already wraps in a script.
//
// Why the bash-side guard is not enough: it watches the Bash tool, and prose is
// not a tool call. An agent that writes "run `gh auth login` to re-auth" has
// routed the operator around the wrapper without invoking anything, and the
// operator then hits the exact failure the wrapper prevents — a login that
// lands the token in ~/.config/gh/hosts.yml, or one missing the scopes the very
// next ghcr read needs. That happened: a session reported a dead credential and
// handed over the raw command, while `pnpm run gh:auth login` sat unmentioned.
//
// The table lives in `_shared/script-redirects.mts` and both surfaces read it,
// so a redirect cannot hold on one and go missing on the other.
//
// Does NOT fire when the reply also names the script. A reply carrying both is
// contrasting them — documenting the rule, or explaining why the raw form is
// wrong — and blocking that would make the rule impossible to write about.
//
// Bypass: `Allow raw-command bypass`, for the rare reply that must quote the
// raw form alone. A bug report about the wrapper itself is the case.

import { block, defineHook, runHook } from '../_shared/guard.mts'
import { findScriptRedirect } from '../_shared/script-redirects.mts'
import {
  bypassPhrasePresent,
  readLastAssistantTurnText,
} from '../_shared/transcript.mts'
import { verdictLine } from '../_shared/verdict.mts'

import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'

const BYPASS_PHRASE = 'Allow raw-command bypass'

/**
 * The reply verdict: a raw command with a script wrapper, handed to the
 * operator.
 *
 * Code fences are NOT stripped. A command an operator is meant to copy is
 * almost always fenced, so stripping them would blind this to the exact shape
 * it exists to catch.
 */
export function findRawCommandVerdict(payload: ToolCallPayload): GuardResult {
  const text = readLastAssistantTurnText(payload.transcript_path)
  if (!text) {
    return undefined
  }
  const redirect = findScriptRedirect(text)
  if (!redirect) {
    return undefined
  }
  if (bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)) {
    return undefined
  }
  return block(
    [
      verdictLine(
        'block',
        'prefer-script-emission-guard',
        `a raw command was handed to the operator - the repo wraps it, and the wrapper owns ${redirect.owns}`,
      ),
      `Fix: say \`${redirect.script}\` instead.`,
    ].join('\n'),
  )
}

export const check = findRawCommandVerdict

export const hook = defineHook({
  bypass: ['raw-command'],
  bypassMode: 'manual',
  check,
  event: ['PostToolUse', 'Stop'],
  // The reply is judged wherever it is written: a raw command recommended from
  // a foreign checkout misleads the operator just as much, and the script it
  // points at lives in the fleet repo the operator is working on.
  global: true,
  triggers: ['gh', 'npm'],
  type: 'guard',
})

void runHook(hook, import.meta.url)
