/*
 * @file An optional positional parameter sitting in front of an options bag
 *   belongs IN the bag. When a signature already carries `options`/`opts`, an
 *   optional scalar ahead of it forces every caller that wants the bag to
 *   write `undefined` in the slot it does not care about, and each of those
 *   `undefined`s is a silent decision nobody reads.
 *
 *   The shape this flags:
 *
 *     fn(required, lookback?, options?)   ← `lookback` belongs in `options`
 *     fn(required, options?)              ← fine
 *     fn(required, optional?)             ← fine, no bag to move it into
 *
 *   Born from `bypassPhrasePresent(path, phrases, lookbackUserTurns?, options?)`.
 *   Every guard passed `undefined` for the lookback, which read as "no opinion"
 *   and actually meant "scan the WHOLE transcript" — so a bypass phrase typed
 *   at the top of a long session still authorized a block hundreds of turns
 *   later, across 176 guards. Nobody chose that; the slot just had to be
 *   filled. In a bag the key is either present and deliberate, or absent and
 *   defaulted where the default lives.
 *
 *   Report-only, never auto-fixed: moving a parameter reshapes the API and
 *   every call site, so the author does it. Skips `.d.ts` (mirrors an external
 *   signature) and test files (throwaway helpers). Bypass: a
 *   `oxlint-disable-next-line socket/no-optional-param-before-options-bag`
 *   comment — earned when the positional order mirrors an upstream signature
 *   the fleet does not own.
 */

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { makeBypassChecker } from '../../lib/comment-markers.mts'
import type { AstNode, RuleContext } from '../../lib/rule-types.mts'

const OPTIONS_PARAM_NAMES = new Set(['options', 'opts'])

/**
 * Resolve a param to its Identifier, unwrapping a default-value pattern.
 * Undefined for a binding pattern with no single name, which has no
 * positional identity to judge.
 */
function paramIdentifier(param: AstNode | undefined): AstNode | undefined {
  if (!param || typeof param !== 'object') {
    return undefined
  }
  if (param.type === 'AssignmentPattern') {
    const left = param.left as AstNode | undefined
    return left?.type === 'Identifier' ? left : undefined
  }
  return param.type === 'Identifier' ? param : undefined
}

/**
 * Whether a param is optional at the CALL site, either `p?` or `p = default`.
 *
 * A default counts: the caller still has to write something in the slot to
 * reach a later argument, and that something is the `undefined` this rule
 * exists to remove.
 */
function isOptionalParam(param: AstNode | undefined): boolean {
  if (!param || typeof param !== 'object') {
    return false
  }
  if (param.type === 'AssignmentPattern') {
    return true
  }
  return param.optional === true
}

/**
 * Whether a param is the options bag: named `options` or `opts`. Rest params
 * are excluded, since a rest cannot be the bag and nothing follows it.
 */
function isOptionsBagParam(param: AstNode | undefined): boolean {
  if (param?.type === 'RestElement') {
    return false
  }
  const ident = paramIdentifier(param)
  return (
    !!ident &&
    typeof ident.name === 'string' &&
    OPTIONS_PARAM_NAMES.has(ident.name)
  )
}

const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'An optional positional parameter in front of an options bag belongs in the bag.',
      category: 'Stylistic Issues',
      recommended: true,
    },
    schema: [],
    messages: {
      optionalParamBeforeOptionsBag:
        'Optional param `{{name}}` before the options bag; move it into the bag as `{{name}}?`.',
    },
  },

  create(context: RuleContext) {
    const hasBypassComment = makeBypassChecker(
      context,
      'socket/no-optional-param-before-options-bag',
    )
    // Normalize once, then every check runs on the same `/`-separated path;
    // the directory test is a plain segment check, not a separator regex.
    const filename = normalizePath(
      context.filename ?? context.getFilename?.() ?? '',
    )
    if (
      /\.d\.[cm]?ts$/.test(filename) ||
      /\.test\.[cm]?[jt]sx?$/.test(filename) ||
      filename.includes('/test/') ||
      filename.startsWith('test/')
    ) {
      return {}
    }

    function checkFunction(node: AstNode): void {
      const params = node.params as AstNode[] | undefined
      if (!Array.isArray(params) || params.length < 2) {
        return
      }
      // The bag anchors the check. Read the LAST one: a signature carrying two
      // is already wrong for other reasons, and the trailing one is the bag a
      // caller actually reaches past.
      let bagIndex = -1
      for (let i = 0, { length } = params; i < length; i += 1) {
        if (isOptionsBagParam(params[i])) {
          bagIndex = i
        }
      }
      if (bagIndex <= 0) {
        return
      }
      for (let i = 0; i < bagIndex; i += 1) {
        const param = params[i]!
        if (!isOptionalParam(param)) {
          continue
        }
        const ident = paramIdentifier(param)
        const name = typeof ident?.name === 'string' ? ident.name : 'parameter'
        if (!hasBypassComment(node)) {
          context.report({
            node: param,
            messageId: 'optionalParamBeforeOptionsBag',
            data: { name },
          })
        }
      }
    }

    return {
      ArrowFunctionExpression: checkFunction,
      FunctionDeclaration: checkFunction,
      FunctionExpression: checkFunction,
      TSDeclareFunction: checkFunction,
      TSMethodSignature: checkFunction,
    }
  },
}

// Oxlint plugin contract requires default-exported rule object.
// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract
export default rule
