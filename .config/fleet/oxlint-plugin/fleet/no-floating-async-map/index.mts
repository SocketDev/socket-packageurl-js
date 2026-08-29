/*
 * @file Forbid an async `.map(...)` left as a bare statement.
 *
 *   `items.map(async item => { await work(item) })` as its own statement builds
 *   an array of promises and discards it. Every callback still runs, so the work
 *   appears to happen and the code reads as a loop that waits. It does not
 *   wait: the function returns before any callback settles, a rejection becomes
 *   an unhandled rejection rather than a caught error, and ordering against
 *   anything after the statement is undefined. The failure is invisible on a
 *   fast machine and arrives as a flake on a slow one.
 *
 *   The fix is to consume the array - `await Promise.all(items.map(...))`, or
 *   `for (const item of items) { await work(item) }` when the work must be
 *   sequential.
 *
 *   Scoped to the BARE-STATEMENT form only, where the array is provably
 *   discarded. A mapped array assigned to a variable is not reported: it is
 *   routinely awaited a few lines later, and flagging it would require tracking
 *   the binding to its consumer. Narrow and certain beats broad and noisy - a
 *   rule that cries wolf on a correct `const results = items.map(async …)` is a
 *   rule people disable.
 *
 *   No autofix. Choosing between `Promise.all` and a sequential loop is a
 *   semantic decision about concurrency, and guessing it would be worse than
 *   reporting.
 */

/**
 * @type {import('eslint').Rule.RuleModule}
 */

import type { AstNode, RuleContext } from '../../lib/rule-types.mts'

function isAsyncFunctionArg(arg: AstNode | undefined): boolean {
  if (!arg) {
    return false
  }
  return (
    (arg.type === 'ArrowFunctionExpression' ||
      arg.type === 'FunctionExpression') &&
    arg.async === true
  )
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid a bare-statement async `.map(...)`. The promise array is discarded, so nothing waits and a rejection goes unhandled.',
      category: 'Possible Errors',
      recommended: true,
    },
    fixable: undefined,
    messages: {
      floatingAsyncMap:
        'This async `.map(...)` is a bare statement, so its promise array is discarded - nothing waits and a rejection is unhandled. Wrap it in `await Promise.all(...)`, or use a `for` loop with `await` when the work must be sequential.',
    },
    schema: [],
  },
  create(context: RuleContext) {
    return {
      ExpressionStatement(node: AstNode) {
        // `await x.map(...)` parses as an AwaitExpression, so reaching here with
        // a CallExpression means nothing consumes the array.
        const { expression } = node
        if (!expression || expression.type !== 'CallExpression') {
          return
        }
        const { callee } = expression
        if (
          callee?.type !== 'MemberExpression' ||
          callee.property?.type !== 'Identifier' ||
          callee.property.name !== 'map'
        ) {
          return
        }
        if (!isAsyncFunctionArg(expression.arguments?.[0])) {
          return
        }
        context.report({
          node,
          messageId: 'floatingAsyncMap',
        })
      },
    }
  },
}

// Oxlint plugin contract requires default-exported rule object.
// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract
export default rule
