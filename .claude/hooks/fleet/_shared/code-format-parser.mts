/*
 * @file The shared inline-code backtick-mistake parser. A small state machine
 *   that flags the CLEAR shell-escaping artifacts that render as literal text
 *   instead of inline code, or as a doubled code span where single backticks
 *   were intended. Used by the guards that scan text for the backtick-mangling
 *   bug: `gh-body-code-format-guard` scans a `gh --body` argument string, and
 *   `reply-code-format-guard` scans the assistant's reply narration.
 *
 *   Why a state machine and not a regex: Markdown backtick parsing follows the
 *   CommonMark run-length-matching rule — a run of k backticks opens a code
 *   span and the span closes at the NEXT run of EXACTLY k backticks. A
 *   double-delimited span can therefore contain single backticks, and vice
 *   versa. A naive regex gets this wrong: it pairs the wrong run lengths, and
 *   it cannot tell a fenced block from an inline span. This parser:
 *
 *   1. Strips fenced code blocks first — a run of 3+ backticks opens a fence,
 *      the content up to a matching closing run of >= the opening length is
 *      OPAQUE, and backslashes/backticks inside it are literal and NEVER
 *      flagged.
 *   2. In the remaining text, flags a backslash immediately before a backtick
 *      (`\``) — always a mistake; it renders a literal backtick, not code.
 *      The escaped backtick is consumed so it does not participate in
 *      run-length matching.
 *   3. Parses inline spans by run-length matching: a run of k=1 or k=2
 *      backticks opens a span; the span closes at the next run of exactly k
 *      backticks. k=2 with no inner backtick is an escaping artifact → flag;
 *      k=2 with an inner backtick is intentional → allow; k=1 is well-formed
 *      → allow; empty/whitespace-only content → flag; no closing run →
 *      unbalanced → flag.
 *
 *   Pure, self-contained on node builtins; exported so a guard composes its
 *   verdict from the hits.
 */

export type CodeFormatKind = 'escaped' | 'doubled' | 'empty' | 'unbalanced'

export interface CodeFormatHit {
  kind: CodeFormatKind
  // The offending span text — the backticks plus their content — for the
  // message.
  span: string
  snippet: string
}

const SNIPPET_RADIUS = 28

/**
 * Replace fenced code blocks with a space. A fence opens with a run of 3+
 * backticks and closes with the next run of >= the opening length; everything
 * between is OPAQUE. An opener with no matching closer is left in place — the
 * inline pass treats a 3+ run as a fence remnant and skips it.
 */
export function stripFencedCodeBlocks(text: string): string {
  const out: string[] = []
  let i = 0
  const len = text.length
  while (i < len) {
    const k = runLength(text, i)
    if (k > 0) {
      if (k >= 3) {
        // Opener of length k. Find a closer: the next run of >= k backticks.
        let j = i + k
        let closed = -1
        while (j < len) {
          const k2 = runLength(text, j)
          if (k2 >= k) {
            closed = j + k2
            break
          }
          // Literal backticks inside the fence — skip the whole run.
          j += k2 || 1
        }
        if (closed > 0) {
          out.push(' ')
          i = closed
          continue
        }
        // Unmatched opener — leave the run in place.
        out.push(text.slice(i, i + k))
        i += k
        continue
      }
      // An inline run of 1 or 2 backticks — copy through; the inline pass
      // parses it.
      out.push(text.slice(i, i + k))
      i += k
      continue
    }
    // A non-backtick run up to the next backtick.
    const next = text.indexOf('`', i)
    const end = next === -1 ? len : next
    out.push(text.slice(i, end))
    i = end
  }
  return out.join('')
}

/**
 * The length of the backtick run starting at `i`.
 */
function runLength(text: string, i: number): number {
  let n = 0
  while (text.charCodeAt(i + n) === 0x60 /* ` */) {
    n += 1
  }
  return n
}

/**
 * Find the next run of EXACTLY k backticks at or after `from`. Returns the
 * index of the run start, or -1 when none exists. A maximal run of length !=
 * k is skipped whole — CommonMark closes a span only with an equal-length run.
 */
function findExactRun(text: string, from: number, k: number): number {
  let j = from
  const len = text.length
  while (j < len) {
    const ch = text.charCodeAt(j)
    if (ch === 0x60 /* ` */) {
      const n = runLength(text, j)
      if (n === k) {
        return j
      }
      // A run of the wrong length is literal content inside the span — skip it.
      j += n
      continue
    }
    j += 1
  }
  return -1
}

/**
 * Scan text for clear inline-code backtick mistakes. Fenced blocks are
 * stripped first; the inline pass then flags escaped backticks, redundant
 * doubled spans, empty spans, and unbalanced runs. Intentional doubled spans
 * whose content holds a backtick, and well-formed single spans, are allowed.
 */
export function findCodeFormatHits(rawText: string): CodeFormatHit[] {
  const hits: CodeFormatHit[] = []
  const text = stripFencedCodeBlocks(rawText)
  const len = text.length

  const snippetAround = (start: number, end: number): string =>
    text
      .slice(
        Math.max(0, start - SNIPPET_RADIUS),
        Math.min(len, end + SNIPPET_RADIUS),
      )
      .replaceAll('\n', ' ')

  let i = 0
  while (i < len) {
    const ch = text.charCodeAt(i)
    // 1. Backslash-escaped backtick — always a mistake outside a fence.
    if (ch === 0x5c /* \ */ && text.charCodeAt(i + 1) === 0x60 /* ` */) {
      hits.push({
        kind: 'escaped',
        span: text.slice(i, i + 2),
        snippet: snippetAround(i, i + 2),
      })
      // Consume both chars so the backtick does not open a span.
      i += 2
      continue
    }
    if (ch === 0x60 /* ` */) {
      const k = runLength(text, i)
      // A 3+ run with no closer was left by the fence pass; skip it.
      if (k >= 3) {
        i += k
        continue
      }
      // k is 1 or 2 — open an inline span. Find a closing run of exactly k.
      const openEnd = i + k
      const closeIdx = findExactRun(text, openEnd, k)
      if (closeIdx === -1) {
        // No closing run — unbalanced. Flag the opening run and continue
        // past it so later backticks can still form runs.
        hits.push({
          kind: 'unbalanced',
          span: text.slice(i, openEnd),
          snippet: snippetAround(i, openEnd),
        })
        i = openEnd
        continue
      }
      const content = text.slice(openEnd, closeIdx)
      if (content.trim() === '') {
        hits.push({
          kind: 'empty',
          span: text.slice(i, closeIdx + k),
          snippet: snippetAround(i, closeIdx + k),
        })
      } else if (k === 2 && !content.includes('`')) {
        // Redundant double — single backticks render identically and were
        // intended. A doubled span whose content DOES hold a backtick is the
        // one legitimate reason to double-delimit, so it is allowed.
        hits.push({
          kind: 'doubled',
          span: text.slice(i, closeIdx + k),
          snippet: snippetAround(i, closeIdx + k),
        })
      }
      // else: well-formed (k=1, or k=2 with an inner backtick) — allow.
      i = closeIdx + k
      continue
    }
    i += 1
  }
  return hits
}
