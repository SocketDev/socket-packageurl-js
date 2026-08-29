#!/usr/bin/env node
// Claude Code PreToolUse hook — pr-comment-brevity-guard.
//
// The wiring, not the law. Every rule this guard blocks on is DEFINED in
// `scripts/fleet/_shared/review-comment-law.mts` — `summaryIntroSmell` for a
// review's top-level intro, `inlineBrevitySmell` for one `comments[].body` —
// and both of those already carry the `<details>`-escape-valve layering and
// the clean-bill-of-health tightening. This file's only job is: extract the
// outbound body from a `gh` command, hand each part to the right law
// function, and turn one or more findings into a block. See that module's
// file doc comment for the full rule set and why it stayed a separate module
// from `pr-body-law.mts` rather than merging with it.
//
// Two extraction paths, because the prose is not always IN the Bash command
// string:
//
//   • Inline forms — `gh pr comment --body "…"`, `gh pr review --comment
//     --body "…"`, `gh api … -f body=…`, `--body-file`/`-F <file>` — reuse
//     `extractProse` (no-github-ai-attribution-guard's) and `extractBodyArg`
//     (convo-prose-nudge's), the same two extractors
//     outbound-voice-nudge's `extractGhVoiceProse` composes for its own
//     phrase scan. Composed here with a Set-based dedup rather than
//     `extractGhVoiceProse` itself: for the common single-flag shape both
//     extractors return the SAME string, which a phrase scan doesn't care
//     about but a LENGTH measurement can't afford to double-count. Yields
//     ONE top-level body; there is no `comments[]` concept on this path.
//   • The JSON-payload form `review-pr-full` actually posts through: `gh api
//     -X POST repos/…/pulls/{n}/reviews --input payload.json` (or a
//     `…/comments` endpoint). The prose lives in the referenced file, never in
//     the command string, so this guard reads and JSON-parses it, pulling
//     `.body` (the review's top-level summary) and each `.comments[].body`
//     (the per-line findings). A missing file or invalid JSON yields
//     `undefined` — fail-open, same posture every other guard takes on a
//     parse failure.
//
// Both law functions apply to the top-level body AND independently to every
// `comments[].body` — one clean part does not hide a violation in another,
// and one violation does not hide a second. All hits collect into one block
// message (verdictLine/verdictContinuation, reply-ref-link-guard's shape for
// a multi-hit verdict).
//
// Bypass: `Allow pr-comment-brevity bypass` — a process/quality guard, not a
// security boundary, so the trailing `bypass` suffix is optional
// (`bypassOptional: true`).

import { readFileSync } from 'node:fs'
import path from 'node:path'

import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import { extractBodyArg } from '../convo-prose-nudge/index.mts'
import { extractProse } from '../no-github-ai-attribution-guard/index.mts'
import {
  commandsFor,
  commandWorkingDir,
  flagValue,
} from '../_shared/shell-command.mts'
import type { Command } from '../_shared/shell-command.mts'
import { verdictContinuation, verdictLine } from '../_shared/verdict.mts'
import {
  inlineBrevitySmell,
  summaryIntroSmell,
} from '../../../../scripts/fleet/_shared/review-comment-law.mts'
import type { ReviewCommentSmell } from '../../../../scripts/fleet/_shared/review-comment-law.mts'

// Dispatcher pre-flight: every path this guard cares about invokes `gh`.
export const triggers: readonly string[] = ['gh']

/**
 * One prose part of an outbound review/comment: the top-level body, or one
 * entry of a JSON payload's `comments[]`. `kind` picks which law function
 * governs it — `summaryIntroSmell` for `'body'`, `inlineBrevitySmell` for
 * `'comment'` — rather than inferring the surface from the label string.
 */
export interface BodyPart {
  readonly label: string
  readonly kind: 'body' | 'comment'
  readonly text: string
}

/**
 * The outbound prose of a `gh` post, split the way GitHub itself splits a
 * review: one top-level `bodyText` (the review summary / a plain comment) and
 * zero or more `comments` (a review's per-line findings). The inline
 * extraction path never populates `comments` — that shape only exists on the
 * JSON-payload path.
 */
export interface OutboundBody {
  readonly bodyText: string | undefined
  readonly comments: readonly BodyPart[]
}

export interface BrevityViolation {
  readonly label: string
  readonly reason: string
}

function toViolation(
  label: string,
  smell: ReviewCommentSmell | undefined,
): BrevityViolation | undefined {
  return smell ? { label, reason: smell.detail } : undefined
}

/**
 * The brevity violation in one body part, or undefined when it passes.
 * Dispatches to the law function that owns the part's surface — never
 * reimplements either measurement.
 */
export function findBrevityViolation(
  part: BodyPart,
): BrevityViolation | undefined {
  const smell =
    part.kind === 'body'
      ? summaryIntroSmell(part.text)
      : inlineBrevitySmell(part.text)
  return toViolation(part.label, smell)
}

/**
 * Every brevity violation across `parts` — one hit does not hide the others.
 */
export function findBrevityViolations(
  parts: readonly BodyPart[],
): BrevityViolation[] {
  const violations: BrevityViolation[] = []
  for (let i = 0, { length } = parts; i < length; i += 1) {
    const violation = findBrevityViolation(parts[i]!)
    if (violation) {
      violations.push(violation)
    }
  }
  return violations
}

/**
 * One block message covering every violation, reply-ref-link-guard's
 * verdictLine/verdictContinuation shape for a multi-hit verdict.
 */
export function renderBrevityBlock(
  violations: readonly BrevityViolation[],
): string {
  const lines: string[] = []
  for (let i = 0, { length } = violations; i < length; i += 1) {
    const v = violations[i]!
    const body = `${v.label}: ${v.reason}`
    lines.push(
      i === 0
        ? verdictLine('block', 'pr-comment-brevity-guard', body)
        : verdictContinuation(body),
    )
  }
  return lines.join('\n')
}

// `gh api` flags that consume the NEXT token as a value. GH_VALUE_FLAGS (the
// shared positional-arg helper) is tuned for `gh pr`/`gh issue`, not `gh
// api` — `-X`/`--method`, `--input`, and the field flags need their own list
// so the path-token scan below never mistakes a flag's value for the path.
const GH_API_VALUE_FLAGS: ReadonlySet<string> = new Set([
  '--cache',
  '--field',
  '--header',
  '--hostname',
  '--input',
  '--jq',
  '--method',
  '--raw-field',
  '--template',
  '-F',
  '-f',
  '-H',
  '-p',
  '-X',
])

/**
 * True when the parsed `gh api` Command targets a `/reviews` or `/comments`
 * REST path — the two endpoints `review-pr-full` posts through.
 */
function isGhApiReviewOrCommentsPath(cmd: Command): boolean {
  const { args } = cmd
  if (!args.includes('api')) {
    return false
  }
  for (let i = 0, { length } = args; i < length; i += 1) {
    const arg = args[i]!
    if (arg.startsWith('-')) {
      if (GH_API_VALUE_FLAGS.has(arg)) {
        i += 1
      }
      continue
    }
    if (arg === 'api') {
      continue
    }
    if (arg.includes('/reviews') || arg.includes('/comments')) {
      return true
    }
  }
  return false
}

interface JsonPayloadShape {
  readonly body?: unknown | undefined
  readonly comments?: unknown | undefined
}

/**
 * Read and JSON-parse `filePath` (resolved against `baseDir` when relative),
 * pulling `.body` and every `.comments[].body`. Returns undefined on a
 * missing file, invalid JSON, a non-object payload, or a payload carrying
 * neither field — fail-open, same posture every other guard takes on a parse
 * failure.
 */
function readJsonInputBody(
  filePath: string,
  baseDir: string,
): OutboundBody | undefined {
  const resolved = path.isAbsolute(filePath)
    ? filePath
    : path.join(baseDir, filePath)
  let raw: string
  try {
    raw = readFileSync(resolved, 'utf8')
  } catch {
    return undefined
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (parsed === null || typeof parsed !== 'object') {
    return undefined
  }
  const obj = parsed as JsonPayloadShape
  const bodyText =
    typeof obj.body === 'string' && obj.body ? obj.body : undefined
  const comments: BodyPart[] = []
  if (Array.isArray(obj.comments)) {
    for (let i = 0, { length } = obj.comments; i < length; i += 1) {
      const entry = obj.comments[i] as unknown
      if (entry === null || typeof entry !== 'object') {
        continue
      }
      const text = (entry as Record<string, unknown>)['body']
      if (typeof text === 'string' && text) {
        comments.push({ label: `comments[${i}]`, kind: 'comment', text })
      }
    }
  }
  if (bodyText === undefined && comments.length === 0) {
    return undefined
  }
  return { bodyText, comments }
}

/**
 * The outbound body a `gh api … --input <file>` posting a review or PR
 * comment would send, read from the referenced JSON file, or undefined when
 * this command carries no such invocation.
 */
export function extractJsonPayloadBody(
  command: string,
): OutboundBody | undefined {
  const baseDir = commandWorkingDir(command)
  for (const cmd of commandsFor(command, 'gh')) {
    if (!isGhApiReviewOrCommentsPath(cmd)) {
      continue
    }
    const inputFile = flagValue(cmd.args, '--input')
    if (!inputFile) {
      continue
    }
    const result = readJsonInputBody(inputFile, baseDir)
    if (result) {
      return result
    }
  }
  return undefined
}

/**
 * The inline prose a `gh` command would post: `extractProse`'s body/title/
 * notes/`gh api` field values plus, per matched `gh` invocation,
 * `extractBodyArg`'s inline-or-`--body-file` value — the same two extractors
 * `outbound-voice-nudge`'s `extractGhVoiceProse` composes, restated nowhere
 * here. Deduped via Set rather than joined verbatim: for the common `gh pr
 * comment --body "…"` shape both extractors return the SAME string, and a
 * PHRASE scan (outbound-voice-nudge's use) doesn't care about that
 * duplication, but a LENGTH measurement does — undeduped, an exactly-at-cap
 * body would double past it on every call.
 */
function extractInlineBody(command: string): string | undefined {
  const values = new Set<string>()
  const prose = extractProse(command)
  if (prose) {
    values.add(prose)
  }
  for (const cmd of commandsFor(command, 'gh')) {
    const body = extractBodyArg(cmd)
    if (body) {
      values.add(body)
    }
  }
  return values.size > 0 ? [...values].join('\n') : undefined
}

/**
 * The outbound body a `gh` command would post, whichever path it goes
 * through: the JSON-payload `--input` file when present, else the inline
 * `--body`/`--body-file`/`gh api -f body=…` forms.
 */
export function extractOutboundBody(command: string): OutboundBody {
  const jsonBody = extractJsonPayloadBody(command)
  if (jsonBody) {
    return jsonBody
  }
  return { bodyText: extractInlineBody(command), comments: [] }
}

/**
 * Flatten an OutboundBody into the list of parts a rule walks: the top-level
 * body (when present) followed by every comment.
 */
export function outboundBodyParts(outbound: OutboundBody): BodyPart[] {
  const parts: BodyPart[] = []
  if (outbound.bodyText) {
    parts.push({ label: 'body', kind: 'body', text: outbound.bodyText })
  }
  parts.push(...outbound.comments)
  return parts
}

export const check = bashGuard((command): GuardResult => {
  const parts = outboundBodyParts(extractOutboundBody(command))
  if (parts.length === 0) {
    return undefined
  }
  const violations = findBrevityViolations(parts)
  if (violations.length === 0) {
    return undefined
  }
  return block(renderBrevityBlock(violations))
})

export const hook = defineHook({
  bypass: ['pr-comment-brevity'],
  bypassOptional: true,
  check,
  event: 'PreToolUse',
  global: true,
  matcher: ['Bash'],
  triggers,
  type: 'guard',
})

void runHook(hook, import.meta.url)
