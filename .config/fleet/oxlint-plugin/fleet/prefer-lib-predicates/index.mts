/*
 * @file Per docs/agents.md/fleet/code-style.md "Object type guards — reach for
 *   isPlainObject from @socketsecurity/lib-stable/objects/predicates, never a
 *   hand-rolled isRecord / isRecordValue / typeof x === 'object' && x !== null
 *   && !Array.isArray(x)". Reports a local declaration of a record/object guard
 *   whose body is the object+not-array test, because the lib guard already
 *   exists and a hand-rolled copy drifts (utils.mts once carried an
 *   isRecordValue that admitted arrays, which is the case the guard exists to
 *   reject). Report-only: the rewrite to isPlainObject is the caller's, since
 *   the guard's exact narrowing (arrays vs built-ins) is a behaviour choice.
 *   Skips the lib's own definition and test files.
 */

/**
 * @type {import('eslint').Rule.RuleModule}
 */

import { makeBypassChecker } from '../../lib/comment-markers.mts'
import type { AstNode, RuleContext } from '../../lib/rule-types.mts'

const BANNED_NAMES = new Set([
  'isObjectRecord',
  'isPlainRecord',
  'isRecord',
  'isRecordValue',
])

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Use isPlainObject from @socketsecurity/lib-stable/objects/predicates instead of a hand-rolled isRecord/isRecordValue guard.',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      banned:
        'Hand-rolled record guard "{{name}}"; use isPlainObject from @socketsecurity/lib-stable/objects/predicates.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    const hasBypassComment = makeBypassChecker(
      context,
      'socket/prefer-lib-predicates',
    )
    return {
      FunctionDeclaration(node: AstNode) {
        const id = node.id
        if (id?.type !== 'Identifier' || !BANNED_NAMES.has(id.name)) {
          return
        }
        if (hasBypassComment(node)) {
          return
        }
        context.report({
          data: { name: id.name },
          node: id,
          messageId: 'banned',
        })
      },
    }
  },
}

// Oxlint plugin contract requires default-exported rule object.
// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract
export default rule
