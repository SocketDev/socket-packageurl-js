#!/usr/bin/env node
// Claude Code Stop hook — silent-guard-compliance-guard.
//
// Code as law: the assistant must NOT acknowledge or mention fleet
// guards/hooks in its chat replies. It silently complies with a guard's
// verdict and carries on; the ONE exception is a human gate (the 🖐
// HUMAN GATE pattern), which MUST be surfaced because it blocks on the
// operator. Naming a guard in a reply — "the guard flagged…", "noted —
// avoiding that", "the hook blocked my push" — turns the fleet's
// enforcement into a conversation the owner never asked for and buries
// the work the turn was supposed to do.
//
// The scan reads the last assistant turn's text. It BLOCKS (exit 2) when
// the reply carries guard-acknowledgment language, EXCEPT when the reply
// contains a human-gate marker (🖐), which allows the entire reply: a
// human gate may name a guard in the context of the gate, and the gate
// must stay visible. A reply that DESCRIBES building a guard — "add a
// new guard that…" — is about CONSTRUCTING enforcement, not acknowledging
// a block, so it is ALLOWED.
//
// Two signals:
//
//   1. Acknowledgment phrases — past-tense / compliance language that
//      names a guard or hook as the actor that just acted: "the guard
//      flagged", "the hook blocked", "noted — avoiding", "I'll comply",
//      "blocked by", "silent compliance". Always block.
//   2. Guard-name mentions — a kebab-case `*-guard` / `*-nudge` token,
//      the fleet naming convention. Block UNLESS the reply carries
//      build-proposal language ("add a new guard", "create a guard
//      that"), which marks the mention as architecture, not
//      acknowledgment.
//
// The human-gate carve-out is checked FIRST and short-circuits both
// signals: a reply surfacing a 🖐 HUMAN GATE is allowed whole, even when
// it names a guard inside the gate block.
//
// No bypass: silently complying (or surfacing a human gate) always
// satisfies the guard, so it can never deadlock against another Stop
// guard — the same argument that keeps anti-prose-guard's and
// reply-ref-link-guard's reply paths bypass-free.

import { block, defineHook, runHook } from '../_shared/guard.mts'
import type { GuardCheck, GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'
import {
  readLastAssistantTurnText,
  stripCodeFences,
} from '../_shared/transcript.mts'
import { verdictContinuation, verdictLine } from '../_shared/verdict.mts'

// The human-gate marker. A reply carrying 🖐 is surfacing a gate the
// operator must clear, so the whole reply is allowed — the gate text may
// name a guard, and the gate must stay visible. Checked before any scan.
const HUMAN_GATE_RE = /🖐/

// A fleet guard or nudge name: kebab-case ending in `-guard` or `-nudge`,
// the naming convention every fleet hook carries. A bare `guard` /
// `nudge` word does NOT match — the prefix is what makes it a specific
// fleet hook rather than the generic noun. Global so each hit is
// collected.
const GUARD_NAME_RE = /\b[a-z][a-z-]+-(?:guard|nudge)\b/g

// `noted` as an acknowledgment: the word "noted" followed (within a short
// window, across optional punctuation) by a compliance / avoidance
// signal. "Noted." as a standalone observation ("as noted in the docs")
// is NOT an acknowledgment; "noted — avoiding that" / "noted, I'll
// comply" is. The em-dash `—`, hyphen, colon, or comma is the shape a
// compliance follow-up takes.
const NOTED_COMPLIANCE_RE =
  /\bnoted\b\s*[—\-:,]?\s*(?:avoid|comply|i will|i'|quiet|silent|understood)/i

// Acknowledgment phrases — past-tense / compliance language that names a
// guard or hook as the actor that just acted, or a compliance promise.
// Each is unambiguous: nobody writes "the guard flagged my push" while
// proposing a new guard. These block regardless of guard-name mentions.
const ACK_PHRASES: readonly RegExp[] = [
  NOTED_COMPLIANCE_RE,
  /\bavoiding (?:it|that)\b/i,
  /\bi'?ll comply\b/i,
  /\bi will comply\b/i,
  /\bi'?ll avoid\b/i,
  /\bi will avoid\b/i,
  /\bsilent(?:ly)? compl(?:iance|y)\b/i,
  /\bquietly comply\b/i,
  /\bunderstood\b\s*[—\-:,]?\s*(?:avoid|comply|i will|i'|quiet|silent)/i,
  // "the guard/hook <past-tense verb>" — the guard as the actor that
  // just blocked/flagged/warned. The verb is what makes it past-tense
  // acknowledgment, not architecture.
  /\bthe guard\b\s+(?:blocked|caught|denied|flagged|prevented|refused|rejected|said|stopped|told|warned)\b/i,
  /\bthe hook\b\s+(?:blocked|caught|denied|flagged|prevented|refused|rejected|said|stopped|told|warned)\b/i,
  /\bblocked by\b/i,
  /\bblocked my\b/i,
  /\bthe block\b/i,
]

// Build-proposal language — the reply DESCRIBES constructing a guard
// (future tense, imperative, a code-as-law proposal), not acknowledging
// one. When present, a guard-name mention reads as architecture, not
// acknowledgment, and is allowed. "add a new guard" / "create a guard
// that blocks…" / "wire a stop guard" / "a guard that will flag…".
const BUILD_PROPOSAL_RE =
  /\b(?:add|build|create|implement|introduce|land|propose|register|scaffold|wire)\s+(?:a\s+|an\s+|the\s+)?(?:fleet\s+|new\s+|posttooluse\s+|pretooluse\s+|stop\s+)*?(?:[a-z][a-z-]+-)?guard\b/i

// A guard-name mention whose surrounding text describes what the guard
// WILL do — "a guard that blocks…", "the foo-guard will flag…". Also a
// build/proposal shape (the guard is being specified, not acknowledged).
const GUARD_WILL_DO_RE =
  /\b(?:[a-z][a-z-]+-)?guard\s+(?:that|which)\s+(?:blocks|catches|checks|flags|prevents|refuses|rejects|scans|should|stops|will)\b/i

// Work-description language — the reply REPORTS work done (editing, building,
// landing, committing, testing a hook/file), or lists hook/file names as the
// objects of that work ("the 9 governance hooks land-fast-nudge, …"). A
// guard-name mention inside a work report is a receipt of files edited, not a
// verdict acknowledgment, so it is allowed. Verdict-acknowledgment phrases
// ("the guard flagged", "the hook blocked", "the block") still block via
// ACK_PHRASES regardless of this context.
const WORK_DESCRIPTION_RE =
  /\b(?:add|added|adding|edit|edited|build|built|fix|fixed|implement|implemented|implementing|commit|committed|committing|update|updated|updating|test|tested|testing|refactor|refactored|refactoring|rename|renamed|renaming|write|wrote|wire|wired|wiring|change|changed|changing|delete|deleted|remov\w+|create|created|creating|make|made|making|sweep|swept|hooks?|files?|modules?)\b/i

const SNIPPET_RADIUS = 32

export interface GuardAckHit {
  // The phrase or guard name that tripped the scan.
  match: string
  // Why it tripped: an acknowledgment phrase, or a guard-name mention
  // with no build-proposal context.
  reason: 'ack-phrase' | 'guard-name'
  snippet: string
}

/**
 * Remove fenced code blocks so a guard name quoted inside a fence (a
 * file path, an import specifier) never fires. Inline code spans are
 * KEPT — a backticked `anti-prose-guard` in chat prose is still naming
 * the guard and is still an acknowledgment.
 */
export function stripFencedBlocks(text: string): string {
  return stripCodeFences(text)
}

/**
 * Whether the stripped reply text carries build-proposal language — the
 * signal that a guard-name mention is architecture, describing a guard
 * to build, not acknowledgment naming a guard that just blocked.
 */
export function hasBuildProposalContext(text: string): boolean {
  return (
    BUILD_PROPOSAL_RE.test(text) ||
    GUARD_WILL_DO_RE.test(text) ||
    WORK_DESCRIPTION_RE.test(text)
  )
}

/**
 * Flattened ±radius snippet around a match, newlines to spaces, so a
 * multi-line verdict line stays one line.
 */
function snippetAround(text: string, index: number, len: number): string {
  const start = Math.max(0, index - SNIPPET_RADIUS)
  const end = Math.min(text.length, index + len + SNIPPET_RADIUS)
  return text.slice(start, end).replaceAll('\n', ' ')
}

/**
 * Scan reply text for guard-acknowledgment language. Fenced code blocks
 * are stripped first. Returns the hits in order: acknowledgment phrases
 * first, then guard-name mentions that lack build-proposal context. A
 * reply with build-proposal language still reports ack-phrase hits (a
 * reply can both propose a guard and acknowledge another), but its
 * guard-name mentions are suppressed.
 */
export function findGuardAckHits(rawText: string): GuardAckHit[] {
  const hits: GuardAckHit[] = []
  const text = stripFencedBlocks(rawText)
  const buildContext = hasBuildProposalContext(text)

  // 1. Acknowledgment phrases — always block, regardless of build context.
  for (let i = 0, { length } = ACK_PHRASES; i < length; i += 1) {
    const re = ACK_PHRASES[i]!
    const m = re.exec(text)
    if (m) {
      hits.push({
        match: m[0],
        reason: 'ack-phrase',
        snippet: snippetAround(text, m.index, m[0].length),
      })
    }
  }

  // 2. Guard-name mentions. Suppressed when the reply carries build-proposal
  //    OR work-description language — there, a name is architecture or a work
  //    receipt (a file edited/built/landed), not acknowledgment. Without that
  //    language, naming a specific guard is acknowledgment, so it blocks.
  if (!buildContext) {
    const seen = new Set<string>()
    let m: RegExpExecArray | null = GUARD_NAME_RE.exec(text)
    while (m) {
      const name = m[0]
      if (!seen.has(name)) {
        seen.add(name)
        hits.push({
          match: name,
          reason: 'guard-name',
          snippet: snippetAround(text, m.index, name.length),
        })
      }
      m = GUARD_NAME_RE.exec(text)
    }
  }

  return hits
}

// The remedy, stated ONCE per verdict. Appended per hit line, an N-hit reply
// renders N copies of the same sentence and the evidence drowns in it.
//
// Carries no 🖐 on purpose. HUMAN_GATE_RE allows a reply whole on the strength
// of that glyph alone, so a message holding it teaches the reply the exact
// character that disarms this guard.
const FIX_LINE =
  'Fix: report the outcome, not what stopped you. Only a human gate is surfaced.'

// Hit lines to show. FIX_LINE takes the third, keeping the whole verdict
// inside the quiet-guards 3-content-line cap; a longer run reports its
// remainder as a count rather than dropping it silently.
const MAX_HIT_LINES = 2

export function findSilentGuardComplianceVerdict(
  payload: ToolCallPayload,
): GuardResult {
  let rawText: string
  try {
    rawText = readLastAssistantTurnText(payload.transcript_path)
  } catch {
    // Fail open on transcript read errors.
    return undefined
  }
  if (!rawText) {
    return undefined
  }
  // Human gate first: a reply surfacing a 🖐 HUMAN GATE is allowed whole.
  if (HUMAN_GATE_RE.test(rawText)) {
    return undefined
  }
  const hits = findGuardAckHits(rawText)
  if (!hits.length) {
    return undefined
  }
  const lines: string[] = []
  const shown = Math.min(hits.length, MAX_HIT_LINES)
  for (let i = 0; i < shown; i += 1) {
    const hit = hits[i]!
    const body =
      hit.reason === 'ack-phrase'
        ? `delete "${hit.match}" near "${hit.snippet}"`
        : `don't name guard "${hit.match}" near "${hit.snippet}"`
    lines.push(
      i === 0
        ? verdictLine('block', 'silent-guard-compliance-guard', body)
        : verdictContinuation(body),
    )
  }
  const remaining = hits.length - shown
  lines.push(
    verdictContinuation(
      remaining > 0 ? `+${remaining} more. ${FIX_LINE}` : FIX_LINE,
    ),
  )
  // Ignores `stop_hook_active` so the verdict survives another guard's
  // retry: a reply rewritten for a different guard can smuggle in a
  // guard acknowledgment (same reasoning as reply-ref-link-guard's reply
  // path).
  return block(lines.join('\n'))
}

// Stop payloads carry no `tool_name`; nothing else should reach this hook,
// but a tool payload returning undefined keeps a miswired entry harmless.
export const check: GuardCheck = payload =>
  payload?.tool_name === undefined
    ? findSilentGuardComplianceVerdict(payload)
    : undefined

export const hook = defineHook({
  check,
  event: 'Stop',
  // MACHINE-WIDE, same reasoning as reply-ref-link-guard and
  // reply-code-format-guard: the reply surface has no repo, and naming a
  // guard is just as much an acknowledgment answering from a foreign
  // checkout.
  global: true,
  type: 'guard',
})

void runHook(hook, import.meta.url)
