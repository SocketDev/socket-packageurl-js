#!/usr/bin/env node
// Claude Code Stop hook — reply-code-format-guard.
//
// Blocks turn-end when the chat reply carries a CLEAR inline-code backtick
// mistake — the shell-escaping artifacts that render as literal text instead
// of code, or as a doubled code span where single backticks were intended.
// The assistant fixes the formatting before the reply goes out.
//
// Three shapes it flags:
//
//   1. Backslash-escaped backtick (`\`foo\``) — a `\` immediately before a
//      `` ` ``. Markdown code spans never need an escaped backtick; it renders
//      as a LITERAL backtick, not code. Always flag.
//   2. Doubled-backtick code span around simple content (`` ``foo`` ``) where
//      the span content contains NO backtick. Single backticks would render
//      identically and are what was intended; the doubling is an escaping
//      artifact. Flag it.
//   3. Empty/back-to-back backticks (`` `` `` or `` ` ` `` with nothing
//      between) or a lone `` ` `` with no closing partner (unbalanced). Flag.
//
// ALLOW: an intentional doubled span `` ``use `foo` here`` `` whose content
// CONTAINS a backtick (the one legitimate reason to double-delimit), fenced
// code blocks (``` ``` … ``` ```), and well-formed single-backtick spans.
//
// Fenced blocks are stripped first so the backticks inside them never fire.
// No bypass: fixing the backticks always satisfies the guard, so it can never
// deadlock against another Stop guard (the same argument that keeps
// anti-prose-guard's and reply-ref-link-guard's reply paths bypass-free).

import { block, defineHook, runHook } from '../_shared/guard.mts'
import type { GuardCheck, GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'
import { readLastAssistantTurnText } from '../_shared/transcript.mts'
import { verdictContinuation, verdictLine } from '../_shared/verdict.mts'

// A fenced code block: 3-backtick fence. Matches the shared
// `FENCED_BLOCK_RE` shape (`/```[\s\S]*?```/g`) so stripping is consistent
// with the rest of the fleet — anything inside a fence is exempt.
const FENCED_BLOCK_RE = /```[\s\S]*?```/g

// A backslash immediately before a backtick — the escaped-backtick artifact.
// Markdown code spans never need an escaped backtick; this renders as a
// literal backtick, not code. Always flag.
const ESCAPED_TICK_RE = /\\`/g

// A doubled-backtick span: `` ``…`` `` with ANY content (lazy, may hold a
// backtick). A span whose content CONTAINS a backtick is the one legitimate
// reason to double-delimit (e.g. `` ``use `foo` here`` ``), so it is ALLOWED;
// a span whose content has NO backtick is an escaping artifact → flag.
const DOUBLED_SPAN_RE = /``([\s\S]*?)``/g

// A single-backtick span: `` `…` `` on one line. Empty or whitespace-only
// content (`` ` ` ``) is an empty/back-to-back mistake → flag; otherwise
// well-formed → allow.
const SINGLE_SPAN_RE = /`([^`\n]*?)`/g

// Any backtick left after fences, doubled spans, and single spans are all
// removed is a lone unbalanced tick with no closing partner → flag.
const LONE_TICK_RE = /`/g

const SNIPPET_RADIUS = 28

export type CodeFormatKind = 'escaped' | 'doubled' | 'empty' | 'unbalanced'

export interface CodeFormatHit {
  kind: CodeFormatKind
  // The offending span text — the backticks plus their content — for the
  // message.
  span: string
  snippet: string
}

/**
 * Remove fenced code blocks so the backticks inside them never fire. Inline
 * spans are KEPT because this guard inspects them; only fences are stripped.
 */
export function stripFencedCodeBlocks(text: string): string {
  return text.replace(FENCED_BLOCK_RE, ' ')
}

/**
 * Scan reply text for clear inline-code backtick mistakes. Fenced blocks are
 * stripped first; the three mistake shapes are then detected in order:
 * escaped backticks, doubled spans with no inner backtick, empty/whitespace
 * single spans, and finally any lone unbalanced backtick. Intentional
 * doubled spans whose content holds a backtick, and well-formed single
 * spans, are
 * allowed and removed before the unbalanced check so their backticks do not
 * read as lone ticks. A doubled span whose content holds a backtick is the
 * one legitimate reason to double-delimit, so it is ALLOWED; a span whose
 * content has NO backtick is an escaping artifact and is flagged.
 */
export function findCodeFormatHits(rawText: string): CodeFormatHit[] {
  const hits: CodeFormatHit[] = []
  const text = stripFencedCodeBlocks(rawText)

  const snippetAround = (start: number, end: number): string =>
    text
      .slice(
        Math.max(0, start - SNIPPET_RADIUS),
        Math.min(text.length, end + SNIPPET_RADIUS),
      )
      .replaceAll('\n', ' ')

  // 1. Backslash-escaped backticks — always flag.
  let m: RegExpExecArray | null = ESCAPED_TICK_RE.exec(text)
  while (m) {
    const start = m.index
    hits.push({
      kind: 'escaped',
      span: m[0],
      snippet: snippetAround(start, start + m[0].length),
    })
    m = ESCAPED_TICK_RE.exec(text)
  }

  // 2. Doubled spans. Remove ALL of them from the text before the single-span
  //    scan so their backticks do not pair up as single spans; flag only the
  //    ones whose content contains NO backtick.
  let m2: RegExpExecArray | null = DOUBLED_SPAN_RE.exec(text)
  while (m2) {
    const content = m2[1]!
    if (!content.includes('`')) {
      hits.push({
        kind: 'doubled',
        span: m2[0],
        snippet: snippetAround(m2.index, m2.index + m2[0].length),
      })
    }
    m2 = DOUBLED_SPAN_RE.exec(text)
  }
  const withoutDoubled = text.replace(DOUBLED_SPAN_RE, ' ')

  // 3. Single spans. Flag empty/whitespace-only content; remove ALL of them
  //    before the lone-tick scan so a well-formed pair never reads as
  //    unbalanced.
  let m3: RegExpExecArray | null = SINGLE_SPAN_RE.exec(withoutDoubled)
  while (m3) {
    const content = m3[1]!
    if (content.trim() === '') {
      hits.push({
        kind: 'empty',
        span: m3[0],
        snippet: snippetAround(m3.index, m3.index + m3[0].length),
      })
    }
    m3 = SINGLE_SPAN_RE.exec(withoutDoubled)
  }
  const withoutSingles = withoutDoubled.replace(SINGLE_SPAN_RE, ' ')

  // 4. Any backtick left is a lone unbalanced tick with no closing partner.
  let m4: RegExpExecArray | null = LONE_TICK_RE.exec(withoutSingles)
  while (m4) {
    const start = m4.index
    hits.push({
      kind: 'unbalanced',
      span: m4[0],
      snippet: snippetAround(start, start + m4[0].length),
    })
    m4 = LONE_TICK_RE.exec(withoutSingles)
  }

  return hits
}

const FIX_HINT =
  'use single backticks `foo` for inline code; only double ``foo`` when the content itself contains a backtick; never backslash-escape backticks in code spans'

export function findReplyCodeFormatVerdict(
  payload: ToolCallPayload,
): GuardResult {
  const rawText = readLastAssistantTurnText(payload.transcript_path)
  if (!rawText) {
    return undefined
  }
  const hits = findCodeFormatHits(rawText)
  if (!hits.length) {
    return undefined
  }
  const lines: string[] = []
  for (let i = 0, { length } = hits; i < length; i += 1) {
    const hit = hits[i]!
    const body = `delete "${hit.span}" - …${hit.snippet}… - ${FIX_HINT}`
    lines.push(
      i === 0
        ? verdictLine('block', 'reply-code-format-guard', body)
        : verdictContinuation(body),
    )
  }
  // Ignores `stop_hook_active` so the verdict survives another guard's retry:
  // a reply rewritten for a different guard can introduce a fresh backtick
  // mistake (same reasoning as reply-ref-link-guard's reply path).
  return block(lines.join('\n'))
}

// Stop payloads carry no `tool_name`; nothing else should reach this hook,
// but a tool payload returning undefined keeps a miswired entry harmless.
export const check: GuardCheck = payload =>
  payload?.tool_name === undefined
    ? findReplyCodeFormatVerdict(payload)
    : undefined

export const hook = defineHook({
  check,
  event: 'Stop',
  // MACHINE-WIDE, same reasoning as reply-ref-link-guard: the reply surface
  // has no repo, and a mangled backtick is just as wrong answering from a
  // foreign checkout.
  global: true,
  type: 'guard',
})

void runHook(hook, import.meta.url)
