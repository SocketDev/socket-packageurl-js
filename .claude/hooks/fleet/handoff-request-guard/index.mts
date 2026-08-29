#!/usr/bin/env node
// Claude Code Stop hook — handoff-request-guard.
//
// "Write a handoff doc" is an instruction to PRODUCE A FILE. The failing
// reading summarizes in chat instead, and that summary scrolls out of the
// context window it was meant to outlive. The whole point of a handoff is to
// exist after the session that wrote it.
//
// Fires at turn-end when BOTH hold:
//   1. The most recent HUMAN turn asked for a handoff document.
//   2. The reply hands back no ABSOLUTE path to one under `.claude/reports/`.
//
// The absolute path is part of the deliverable, not a formatting nicety.
// Reports are gitignored, so `reports/x.md` cannot be resolved by a reader who
// does not already know which checkout the session was rooted in, and sessions
// here routinely span several. A reply that cites only a relative path gets a
// different message, because writing the file and then citing an unusable path
// is a different mistake from not writing it.
//
// A Stop hook rather than PreToolUse on purpose: gathering the facts a handoff
// needs takes tool calls, and a PreToolUse gate would block the research it is
// asking for. This one lets the turn do the work and refuses to END until the
// document exists.
//
// Bypass: `Allow handoff-request bypass`, for when the ask was rhetorical or
// the document belongs somewhere this guard cannot see.

import {
  citesReportAbsolutePath,
  citesReportPathAtAll,
  isHandoffRequest,
} from '../_shared/handoff-request.mts'
import { block, defineHook, runHook } from '../_shared/guard.mts'
import {
  bypassPhrasePresent,
  readHumanUserText,
  readLastAssistantTurnText,
} from '../_shared/transcript.mts'
import { verdictLine } from '../_shared/verdict.mts'

import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'

export const BYPASS_PHRASE = 'Allow handoff-request bypass'

const NAME = 'handoff-request-guard'

/**
 * The verdict for a turn that produced no document.
 */
export function missingDocumentMessage(): string {
  return [
    verdictLine(
      'block',
      NAME,
      'a handoff was asked for and no document was written.',
    ),
    'Fix: `node scripts/fleet/write-handoff.mts <slug>` mints it and prints the absolute path; fill it in, then report that path.',
  ].join('\n')
}

/**
 * The verdict for a turn that wrote one but cited it unusably.
 */
export function relativePathMessage(): string {
  return [
    verdictLine(
      'block',
      NAME,
      'the handoff path is relative, which a reader cannot resolve.',
    ),
    'Fix: report the ABSOLUTE path (reports are gitignored, so the repo root is not inferable); `write-handoff.mts` prints it.',
  ].join('\n')
}

export function findHandoffRequestVerdict(
  payload: ToolCallPayload,
): GuardResult {
  const transcriptPath = payload?.transcript_path
  if (!transcriptPath) {
    return undefined
  }
  if (!isHandoffRequest(readHumanUserText(transcriptPath, 1))) {
    return undefined
  }
  if (bypassPhrasePresent(transcriptPath, BYPASS_PHRASE)) {
    return undefined
  }
  let reply: string
  try {
    reply = readLastAssistantTurnText(transcriptPath)
  } catch {
    // Fail open on a transcript read error: a hook bug must not trap a turn.
    return undefined
  }
  if (citesReportAbsolutePath(reply)) {
    return undefined
  }
  return block(
    citesReportPathAtAll(reply)
      ? relativePathMessage()
      : missingDocumentMessage(),
  )
}

export const check = findHandoffRequestVerdict

export const hook = defineHook({
  bypass: ['handoff-request'],
  bypassMode: 'manual',
  bypassOptional: true,
  check,
  event: 'Stop',
  type: 'guard',
})
void runHook(hook, import.meta.url)
