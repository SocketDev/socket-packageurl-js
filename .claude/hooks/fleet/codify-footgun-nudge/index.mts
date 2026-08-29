#!/usr/bin/env node
// Claude Code Stop / PostToolUse hook — codify-footgun-nudge.
//
// Fires when a reply ADMITS repeating a known mistake without naming anything
// that prevents the next one.
//
// Why the admission is the trigger: "I hit that footgun again", "my own notes
// warned about this", "same mistake as earlier" all report that the loop closed
// on nothing. A note already existed and was not consulted in time, so writing
// another note is the one response guaranteed not to help. The pass that hits a
// footgun is the pass that can still afford to codify it.
//
// Silence is keyed on EVIDENCE rather than wording: a reply naming a hook, a
// lint rule, a fleet script, or the `codifying-footguns` skill has produced
// something executable. One that admits and names nothing has not.
//
// A NUDGE, never a block. The admission is often exactly the right prose — a
// post-mortem, a report explaining a rule, this hook's own doc — and blocking
// those would make the honest report the expensive one.
//
// Bypass: `Allow footgun-note bypass`.

import { defineHook, notify, runHook } from '../_shared/guard.mts'
import { findUncodifiedAdmission } from '../_shared/footgun-admission.mts'
import {
  bypassPhrasePresent,
  readLastAssistantTurnText,
} from '../_shared/transcript.mts'

import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'

const BYPASS_PHRASE = 'Allow footgun-note bypass'

/**
 * The nudge verdict: an admission with nothing executable named beside it.
 */
export function findUncodifiedFootgunVerdict(
  payload: ToolCallPayload,
): GuardResult {
  const text = readLastAssistantTurnText(payload.transcript_path)
  if (!text) {
    return undefined
  }
  const admission = findUncodifiedAdmission(text)
  if (!admission) {
    return undefined
  }
  if (bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)) {
    return undefined
  }
  return notify(
    [
      `codify-footgun-nudge: "${admission}" names a repeat, and this turn produced nothing that catches the next one.`,
      'Fix: run the `codifying-footguns` skill - measure the pattern, then write the hook, lint rule, or script it calls for.',
    ].join('\n'),
  )
}

export const check = findUncodifiedFootgunVerdict

export const hook = defineHook({
  bypass: ['footgun-note'],
  bypassMode: 'manual',
  check,
  event: ['PostToolUse', 'Stop'],
  // A repeated mistake is worth codifying wherever it happened, and the
  // artifacts it points at live in the fleet repo regardless of the cwd.
  global: true,
  type: 'nudge',
})

void runHook(hook, import.meta.url)
