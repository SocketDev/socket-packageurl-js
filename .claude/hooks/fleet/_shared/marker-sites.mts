/*
 * @file Tell a real opt-out marker from a MENTION of one.
 *
 *   `// socket-lint: allow console` in a comment is a marker. The same text
 *   inside a string literal is documentation — a guard's help text, a rule's
 *   error message, a doc example. A regex cannot separate them, and that one
 *   confusion has now broken three separate efforts:
 *
 *     - the bypass-marker audit reported ~40 live suppressions as deletable,
 *       every hit being marker syntax quoted in a guard's own help text;
 *     - a second pass, narrowed to scanner-backed rules, was still 100% wrong
 *       for the same reason;
 *     - the migration to oxlint's grammar rewrote a sentence inside an
 *       AI-guidance string, and picked the wrong directive doing it, because a
 *       mid-string match reads as a trailing marker.
 *
 *   So: parse, and count a marker only when it lives in a COMMENT node. This is
 *   the shared primitive both the audit and the migration are blocked on.
 *
 *   Fail-closed. A file that will not parse reports `parsed: false` with no
 *   sites, never an empty list that reads as "no markers here" — the same
 *   blindness-is-not-absence rule the retirement sweep follows.
 */

import { tryParse } from './ast/core.mts'
import { walkComments } from './ast/comments.mts'
import type { ParseOptions } from './ast/core.mts'

/**
 * Which spelling a marker uses. Both are live during the migration to oxlint's
 * grammar; `legacy` is the bespoke `socket-lint: allow <id>` form.
 */
export type MarkerSpelling = 'legacy' | 'oxlint'

/**
 * One genuine opt-out marker, located in a comment.
 */
export interface MarkerSite {
  /**
   * The rule the marker names. Undefined for the bare `socket-lint: allow`
   * blanket form, which names none — the oxlint spelling always names one.
   */
  id: string | undefined
  /**
   * 1-based line of the comment's opening marker.
   */
  line: number
  /**
   * True when the comment starts its own line, so it covers the line BELOW.
   * False for a trailing comment, which covers the line it sits on. This is
   * the distinction that decides `-next-line` vs `-line`.
   */
  ownLine: boolean
  spelling: MarkerSpelling
}

/**
 * The result of scanning one file. `parsed` is the honest half: false means
 * the source could not be parsed, so the empty `sites` list carries no
 * information. A caller that treats it as "no markers" reintroduces exactly
 * the bug this module exists to remove.
 */
export interface MarkerScan {
  parsed: boolean
  sites: MarkerSite[]
}

// Matched against a comment's BODY — the text between the markers — so these
// carry no `//` / `#` / `/*` prefix of their own. Searched anywhere in the
// body, not anchored, because a marker may follow other prose on the line.
const LEGACY_IN_BODY_RE = /socket-lint:\s*allow(?:\s+([\w-]+))?/

// `oxlint-disable`, then an optional `next-` (group 1, present for the
// own-line form and absent for the trailing one), `line`, then the
// `socket/`-scoped rule name in group 2.
const OXLINT_IN_BODY_RE = /oxlint-disable-(next-)?line\s+socket\/([\w-]+)/

// A comment opens its own line when the trimmed source line for that comment
// begins with a comment opener. `CommentSite.text` is already that trimmed
// line, so no re-slicing of the source is needed.
const LINE_STARTS_WITH_COMMENT_RE = /^(?:#|\/\*|\/\/)/

/**
 * The marker a comment body names, or undefined when it names none. Pure and
 * prefix-free: pass the body, not the whole line.
 */
export function markerInCommentBody(
  body: string,
): { id: string | undefined; spelling: MarkerSpelling } | undefined {
  const oxlint = OXLINT_IN_BODY_RE.exec(body)
  if (oxlint) {
    return { id: oxlint[2], spelling: 'oxlint' }
  }
  const legacy = LEGACY_IN_BODY_RE.exec(body)
  if (legacy) {
    return { id: legacy[1], spelling: 'legacy' }
  }
  return undefined
}

/**
 * Every genuine marker in `source`, located by parsing rather than scanning.
 * Marker text inside a string or template literal is never reported: this walk
 * only ever visits comment nodes, so a literal is not merely filtered out — it
 * is never seen.
 *
 * `options` forwards to the parser for callers that need a non-default source
 * type; `comments` is always forced on.
 */
export function findMarkerSites(
  source: string,
  options?: ParseOptions | undefined,
): MarkerScan {
  // Parse once up front purely to learn whether the file is parseable at all.
  // `walkComments` swallows its own parse failure and returns [], which is
  // indistinguishable from a clean file with no comments.
  if (tryParse(source, options) === undefined) {
    return { parsed: false, sites: [] }
  }
  const comments = walkComments(source, {
    __proto__: null,
    ...options,
    comments: true,
  } as unknown as ParseOptions)
  const sites: MarkerSite[] = []
  for (let i = 0, { length } = comments; i < length; i += 1) {
    const comment = comments[i]!
    const marker = markerInCommentBody(comment.value)
    if (!marker) {
      continue
    }
    sites.push({
      id: marker.id,
      line: comment.line,
      ownLine: LINE_STARTS_WITH_COMMENT_RE.test(comment.text.trim()),
      spelling: marker.spelling,
    })
  }
  return { parsed: true, sites }
}

/**
 * The oxlint directive that preserves a marker's meaning at its position:
 * a comment on its own line covers the line below (`-next-line`), a trailing
 * comment covers the line it sits on (`-line`). Naming this mapping once keeps
 * the migration from having to re-derive it per call site.
 */
export function directiveFor(site: MarkerSite): string {
  return site.ownLine ? 'oxlint-disable-next-line' : 'oxlint-disable-line'
}
