#!/usr/bin/env node
// Claude Code PreToolUse hook — pr-comment-shape-nudge.
//
// The judgment-call half of `pr-comment-brevity-guard`: never blocks, only
// suggests a better SHAPE for an outbound PR comment/review once brevity is
// already satisfied. Shares that guard's body extraction
// (`extractOutboundBody`) so the two never diverge on what a `gh` command is
// about to post.
//
// Two independent nudges:
//
//   Nudge A — the top-level body names a file (a path-like token ending in a
//     common source extension) or a line number (`:123`) in PROSE, while the
//     review posts no `comments[]` at all. A finding tied to one line reads
//     better as an inline comment anchored there than as a paragraph
//     describing where to look.
//   Nudge B — a comment (top-level body or any `comments[].body`) reads like
//     a MECHANICAL fix ("rename", "typo", "off-by-one", "missing await", …)
//     but carries no ```suggestion fenced block. A one-line fix is a
//     one-click apply when it ships as a suggestion; prose asking the human
//     to type the same edit is friction the tool exists to remove. A fix
//     needing real design judgment should NOT get a forced suggestion — this
//     nudge only fires on the mechanical-sounding keyword set, never on
//     every comment.
//
// Both checks reuse the SAME extraction as the brevity guard, so a `gh`
// invocation this guard never blocks for length can still earn a shape
// suggestion here.

import { bashGuard, defineHook, notify, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import {
  extractOutboundBody,
  outboundBodyParts,
} from '../pr-comment-brevity-guard/index.mts'
import type {
  BodyPart,
  OutboundBody,
} from '../pr-comment-brevity-guard/index.mts'
import { verdictContinuation, verdictLine } from '../_shared/verdict.mts'
import { suggestionBlocks } from '../../../../scripts/fleet/_shared/review-comment-law.mts'

// Dispatcher pre-flight: every path this nudge cares about invokes `gh`.
export const triggers: readonly string[] = ['gh']

// A path-like token ending in a common source extension — the "this lives in
// FILE" shape a prose finding uses instead of an inline comment.
const FILE_PATH_RE = /\w[\w./-]+\.(?:ts|tsx|js|mjs|mts|py|go|rs|rb|java)\b/
// A `:123` line-number shape, the other half of "FILE:LINE" prose.
const LINE_NUMBER_RE = /:\d+\b/

/**
 * True when `text` names a file or line number in prose — the shape a
 * per-line finding should be an inline comment instead of.
 */
export function namesFileOrLine(text: string): boolean {
  return FILE_PATH_RE.test(text) || LINE_NUMBER_RE.test(text)
}

/**
 * Keywords suggesting the fix described is MECHANICAL — small enough that a
 * fenced suggestion block should carry the literal edit rather than prose
 * asking for it. Sorted ASCII; a real design-judgment fix never matches this
 * list, so this nudge stays silent on it by construction.
 */
export const MECHANICAL_FIX_KEYWORDS: readonly string[] = [
  'add a null check',
  'missing await',
  'off-by-one',
  'one-line',
  'rename',
  'swap',
  'typo',
  'wrong operator',
]

/**
 * True when `text` sounds like a mechanical fix — carries one of
 * MECHANICAL_FIX_KEYWORDS.
 */
export function soundsMechanical(text: string): boolean {
  const lower = text.toLowerCase()
  return MECHANICAL_FIX_KEYWORDS.some(keyword => lower.includes(keyword))
}

/**
 * Nudge A's hint, or undefined when it doesn't apply: the top-level body
 * names a file/line in prose AND the review posts no `comments[]` at all.
 */
export function inlineAnchorHint(outbound: OutboundBody): string | undefined {
  const { bodyText, comments } = outbound
  if (!bodyText || comments.length > 0 || !namesFileOrLine(bodyText)) {
    return undefined
  }
  return 'body names a file/line in prose but posts no comments[] - anchor an inline comment at that file/line instead of describing it in the review summary'
}

/**
 * Nudge B's hints: one per body part that sounds mechanical but carries no
 * ```suggestion block. `suggestionBlocks` is review-comment-law.mts's own
 * fence parser (the SAME one `pr-comment-brevity-guard` and
 * `reviewCommentSmells` use) — a hand-rolled regex here would drift from it.
 */
export function suggestionBlockHints(parts: readonly BodyPart[]): string[] {
  const hints: string[] = []
  for (let i = 0, { length } = parts; i < length; i += 1) {
    const part = parts[i]!
    if (
      soundsMechanical(part.text) &&
      suggestionBlocks(part.text).length === 0
    ) {
      hints.push(
        `${part.label}: sounds like a mechanical fix but carries no \`\`\`suggestion block - add one so the fix is a one-click apply`,
      )
    }
  }
  return hints
}

export const check = bashGuard((command): GuardResult => {
  const outbound = extractOutboundBody(command)
  const parts = outboundBodyParts(outbound)
  if (parts.length === 0) {
    return undefined
  }
  const hints: string[] = []
  const anchorHint = inlineAnchorHint(outbound)
  if (anchorHint) {
    hints.push(anchorHint)
  }
  hints.push(...suggestionBlockHints(parts))
  if (hints.length === 0) {
    return undefined
  }
  const lines = hints.map((hint, i) =>
    i === 0
      ? verdictLine('hint', 'pr-comment-shape-nudge', hint)
      : verdictContinuation(hint),
  )
  return notify(lines.join('\n'))
})

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  global: true,
  matcher: ['Bash'],
  triggers,
  type: 'nudge',
})

void runHook(hook, import.meta.url)
