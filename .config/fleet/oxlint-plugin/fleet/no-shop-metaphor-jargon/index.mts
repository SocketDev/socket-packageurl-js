/**
 * @file Flag shop-metaphor jargon in a comment: `seam` and `wedge`. Both name a
 *   picture of a mechanism instead of the mechanism. A "testing seam" is an
 *   injection point, the parameter a caller passes a fake through, or the
 *   injected dependency itself. A "wedged" process is an unresponsive one, or a
 *   stuck one when that is what was measured. A reader who does not already
 *   know the metaphor learns nothing from it, and `wedged` quietly overclaims:
 *   it asserts a stuck internal state that a timing-out health probe cannot
 *   tell apart from a crash or a restart.
 *   This is the LINT-TIME third of the rule. `anti-prose-guard`'s
 *   `shop-metaphor jargon` pattern catches a word as an agent writes it, the
 *   `outbound-voice-nudge` catalog catches it leaving the session, and this
 *   catches a word already sitting in a comment, so a codemod, a human edit, or
 *   a cascade cannot regrow the corpus behind the hooks' backs.
 *   Receipt for the scope: a repo-wide sweep retired 2,006 identifier tokens
 *   and rewrote the prose in 531 files. The gap this rule closes is the one
 *   that made the sweep necessary in the first place, since none of the 643
 *   files was ever written through a surface a hook watched.
 *   The word AS DATA is not a finding. A catalog that bans `seam` has to spell
 *   it, and its comments have to explain what it matches. So a match inside a
 *   backtick span (`` `seam` ``) or inside a quoted span ("wedged") is skipped:
 *   both mark the token as the thing under discussion rather than a metaphor
 *   the comment is leaning on. `seamless`, `seamstress`, and `inseam` never
 *   match, because the word boundary is exact.
 *   REPORTS ONLY, no autofix. The replacement depends on which mechanism the
 *   comment meant: an injection point, an injected dependency, a boundary, an
 *   extension point, unresponsive, or stuck. A blanket substitution would put
 *   the wrong one in most sites, and a comment that says the wrong thing is
 *   worse than one that says it in jargon.
 */

import type { AstNode, RuleContext } from '../../lib/rule-types.mts'

// The banned tokens, matched whole. `seams?` covers the plural; the `wedge`
// group covers the verb forms a stuck-process comment reaches for. Exact
// boundaries leave `seamless`, `seamstress`, `inseam`, and `wedgie` alone.
const JARGON_RE = /\b(?:seams?|wedge[sd]?)\b/gi

// A line carrying this marker is exempt. Reserved for a comment that must use
// the word bare, which in practice means documentation OF the ban whose own
// wording cannot be quoted.
export const JARGON_ALLOW_LINE = 'shop-metaphor: allow'

/**
 * True when the offset sits inside a backtick inline-code span, judged by an
 * odd number of backticks before it on the same line. Pure + exported for the
 * unit test. Line-scoped on purpose: a stray backtick elsewhere in a long
 * comment must not flip every later line's verdict.
 */
export function insideCodeSpan(line: string, offset: number): boolean {
  let ticks = 0
  for (let i = 0; i < offset; i += 1) {
    if (line[i] === '`') {
      ticks += 1
    }
  }
  return ticks % 2 === 1
}

/**
 * True when the offset sits inside a single- or double-quoted span on the same
 * line. Pure + exported for the unit test. Quoting a word names it as data,
 * which is what a banned-word catalog's own comments do.
 */
export function insideQuotedSpan(line: string, offset: number): boolean {
  let inSingle = false
  let inDouble = false
  for (let i = 0; i < offset; i += 1) {
    const ch = line[i]
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble
    } else if (ch === "'" && !inDouble) {
      inSingle = !inSingle
    }
  }
  return inSingle || inDouble
}

/**
 * Every shop-metaphor token in `text` that reads as prose, each returned as the
 * matched word. Pure + exported for the unit test. A token quoted as data, or
 * on a line carrying the allow marker, is not a finding.
 */
export function shopMetaphors(text: string): string[] {
  const out: string[] = []
  const lines = text.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (line.includes(JARGON_ALLOW_LINE)) {
      continue
    }
    const matches = line.matchAll(JARGON_RE)
    for (const m of matches) {
      const offset = m.index
      if (insideCodeSpan(line, offset) || insideQuotedSpan(line, offset)) {
        continue
      }
      out.push(m[0])
    }
  }
  return out
}

const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Forbid shop-metaphor jargon (`seam`, `wedge`) in a comment. Name the mechanism: an injection point, the injected dependency, a boundary, an extension point, unresponsive, or stuck.',
      category: 'Stylistic Issues',
      recommended: true,
    },
    // NOT `fixable: 'code'`. Which plain term is right depends on what the
    // comment meant, and a blanket substitution would be wrong at most sites.
    messages: {
      shopMetaphor:
        'Comment uses shop-metaphor jargon `{{word}}`; name the mechanism instead.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    const sourceCode = context.getSourceCode
      ? context.getSourceCode()
      : context.sourceCode
    return {
      Program() {
        const comments: AstNode[] = sourceCode.getAllComments
          ? sourceCode.getAllComments()
          : []
        for (let i = 0, { length } = comments; i < length; i += 1) {
          const comment = comments[i]!
          const value = (comment.value as string) ?? ''
          const words = shopMetaphors(value)
          for (let j = 0, { length: n } = words; j < n; j += 1) {
            context.report({
              node: comment as unknown as AstNode,
              messageId: 'shopMetaphor',
              data: { word: words[j]! },
            })
          }
        }
      },
    }
  },
}

// Oxlint plugin contract requires default-exported rule object.
// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract
export default rule
