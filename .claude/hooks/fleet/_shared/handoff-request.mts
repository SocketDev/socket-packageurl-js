/*
 * @file "Write a handoff doc" is an instruction to PRODUCE A FILE, not to
 *   summarize in chat. The two readings look alike from the inside and are
 *   not: one leaves a document the next session can open, the other leaves a
 *   reply that scrolls away with the context window.
 *
 *   These are the pure halves of `handoff-request-guard`: did the human ask
 *   for a handoff, and does the reply hand back an absolute path to one. Both
 *   string-only, so the guard's decision is testable without a transcript.
 *
 *   The absolute-path half is a requirement in its own right, not a proxy for
 *   "was the file written". A relative path is useless to the reader: reports
 *   live in a gitignored tree, so the operator cannot resolve `reports/x.md`
 *   against anything without knowing which repo the session was rooted in.
 */

/**
 * A request for a handoff document.
 *
 * Matches the shapes an operator actually types, all of which need a noun that
 * means "the artifact": `handoff`, or `hand-off`, or `hand off`. The verb is
 * loose on purpose (`write`, `create`, `do`, `make`, `start`) because the ask
 * arrives mid-sentence as often as it opens one.
 */
const HANDOFF_REQUEST_RE =
  /\b(?:creat(?:e|ing)|do|draft(?:ing)?|generate|mak(?:e|ing)|produce|start|writ(?:e|ing))\b[^.!?\n]{0,40}\bhand[\s-]?off\b/i

/**
 * A bare mention of the artifact, with no verb. `handoff doc` on its own line
 * is an instruction; `the handoff mentions X` is not, which is why the noun
 * has to be followed by a document word.
 */
const HANDOFF_NOUN_RE = /\bhand[\s-]?off\s+(?:doc(?:ument)?|md|note|report)\b/i

/**
 * Past-tense or third-party talk ABOUT a handoff, which is not a request.
 * "the handoff said", "per the handoff", "I read the handoff" all describe one
 * that already exists.
 */
const NOT_A_REQUEST_RE =
  /\b(?:per|from|in|read|reading|per the|according to)\s+(?:the\s+)?hand[\s-]?off\b|\bhand[\s-]?off\s+(?:claimed|mentions|noted|notes|said|says)\b/i

/**
 * Whether `text` asks for a handoff document to be written.
 */
export function isHandoffRequest(text: string | undefined): boolean {
  if (!text) {
    return false
  }
  if (NOT_A_REQUEST_RE.test(text)) {
    return false
  }
  return HANDOFF_REQUEST_RE.test(text) || HANDOFF_NOUN_RE.test(text)
}

/**
 * An absolute path to a markdown file under a reports tree, as it would appear
 * in a reply.
 *
 * Anchored on `/.claude/reports/` rather than on any path: the guard is asking
 * "did you hand back the report's location", and a random absolute path in the
 * reply does not answer that. Windows drive-letter form is accepted because a
 * report written there is still a report.
 */
const REPORT_ABS_PATH_RE =
  /(?:^|[\s(`'"])(?:[A-Za-z]:[\\/]|\/)[^\s`'"]*[\\/]\.claude[\\/]reports[\\/][^\s`'"]*\.md\b/

/**
 * Whether `text` hands back an absolute path to a report.
 */
export function citesReportAbsolutePath(text: string | undefined): boolean {
  return Boolean(text) && REPORT_ABS_PATH_RE.test(text!)
}

/**
 * Whether `text` mentions a report path but only as a RELATIVE one.
 *
 * Separated from the absolute check so the guard can say which mistake was
 * made: forgetting the document entirely reads differently from writing it and
 * then citing a path the reader cannot resolve.
 */
const REPORT_REL_PATH_RE = /\.claude[\\/]reports[\\/][^\s`'"]*\.md\b/

export function citesReportPathAtAll(text: string | undefined): boolean {
  return Boolean(text) && REPORT_REL_PATH_RE.test(text!)
}
