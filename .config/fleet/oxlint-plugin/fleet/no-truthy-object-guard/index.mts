/*
 * @file Per docs/agents.md/fleet/code-style.md "Object type guards": an object
 *   guard must be `typeof x === 'object' && x !== null` (or the lib's
 *   isPlainObject), NEVER `x && typeof x === 'object'`. `typeof null ===
 *   'object'` is a JavaScript hazard older than the fleet; a truthiness guard
 *   (`x &&`) does NOT exclude `null` when the value is later narrowed by the
 *   typeof check — and `x` being truthy admits `0`/`''` rejections that have
 *   nothing to do with object-ness. The canonical form tests the type FIRST,
 *   then excludes `null` explicitly, so the narrowed branch is provably a
 *   non-null object. This rule flags a LogicalExpression(`&&`) where one
 *   operand is `typeof <id> === 'object'` (in either order) and the other
 *   operand is the SAME `<id>` Identifier used as a bare truthiness guard.
 *   Autofix: rewrites the truthiness operand to `<id> !== null`, preserving
 *   operand order. Reports once per offending operand. Bypass:
 *   `oxlint-disable-next-line socket/no-truthy-object-guard`.
 */

/**
 * @type {import('eslint').Rule.RuleModule}
 */

import { makeBypassChecker } from '../../lib/comment-markers.mts'
import type { AstNode, RuleContext, RuleFixer } from '../../lib/rule-types.mts'

// Is `node` a `typeof X === 'object'` (or `'object' === typeof X`) binary
// expression over the identifier `name`? Returns the matched identifier node
// so the caller can compare it to the truthiness operand.
function matchTypeofObjectCheck(
  node: AstNode,
  name: string,
): AstNode | undefined {
  if (node?.type !== 'BinaryExpression' || node.operator !== '===') {
    return undefined
  }
  const { left, right } = node
  // `typeof X === 'object'`
  if (
    left?.type === 'UnaryExpression' &&
    left.operator === 'typeof' &&
    left.argument?.type === 'Identifier' &&
    left.argument.name === name &&
    right?.type === 'Literal' &&
    right.value === 'object'
  ) {
    return left.argument
  }
  // `'object' === typeof X`
  if (
    right?.type === 'UnaryExpression' &&
    right.operator === 'typeof' &&
    right.argument?.type === 'Identifier' &&
    right.argument.name === name &&
    left?.type === 'Literal' &&
    left.value === 'object'
  ) {
    return right.argument
  }
  return undefined
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        "Object guard must be `typeof x === 'object' && x !== null`, never `x && typeof x === 'object'` — `typeof null === 'object'` so a truthiness guard admits null. Per code-style.md \"Object type guards\".",
      category: 'Possible Errors',
      recommended: true,
    },
    fixable: 'code',
    messages: {
      truthyGuard:
        'Object guard admits `null`; use `typeof {{name}} === "object" && {{name}} !== null`.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    const hasBypassComment = makeBypassChecker(
      context,
      'socket/no-truthy-object-guard',
    )
    return {
      LogicalExpression(node: AstNode) {
        if (node.operator !== '&&') {
          return
        }
        const { left, right } = node
        // `X && typeof X === 'object'` — left is the truthiness guard.
        if (
          left?.type === 'Identifier' &&
          matchTypeofObjectCheck(right, left.name)
        ) {
          if (hasBypassComment(node)) {
            return
          }
          context.report({
            node,
            data: { name: left.name },
            messageId: 'truthyGuard',
            fix(fixer: RuleFixer) {
              return fixer.replaceText(left, `${left.name} !== null`)
            },
          })
          return
        }
        // `typeof X === 'object' && X` — right is the truthiness guard.
        if (
          right?.type === 'Identifier' &&
          matchTypeofObjectCheck(left, right.name)
        ) {
          if (hasBypassComment(node)) {
            return
          }
          context.report({
            node,
            data: { name: right.name },
            messageId: 'truthyGuard',
            fix(fixer: RuleFixer) {
              return fixer.replaceText(right, `${right.name} !== null`)
            },
          })
        }
      },
    }
  },
}

// Oxlint plugin contract requires default-exported rule object.
// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract
export default rule
