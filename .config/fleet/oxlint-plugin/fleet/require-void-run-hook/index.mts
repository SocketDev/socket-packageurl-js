/*
 * @file Require `void` on a hook's `runHook(hook, import.meta.url)` entry call.
 *
 *   This is not a style preference and the cost of missing it is not an
 *   unhandled rejection. `scripts/fleet/_shared/dispatch-scan.mts` decides which
 *   hooks are bundle-safe by MATCHING SOURCE TEXT:
 *
 *     const ENTRYPOINT_GUARD_RE =
 *       /\bvoid\s+runHook\s*\(\s*hook\s*,\s*import\.meta\.url/
 *
 *   A hook whose entry call lacks the `void` fails that match, so it is dropped
 *   from the generated dispatch table and never runs. Nothing reports it: the
 *   file exists, its tests pass because they import the check directly, the
 *   generator's own count goes up by zero, and the guard is silently dead. That
 *   is the failure this rule exists to make impossible, and it has already
 *   happened once.
 *
 *   Autofixable, because the rewrite is exactly one token and carries no
 *   judgement: `runHook(...)` becomes `void runHook(...)`.
 *
 *   Scoped to `runHook` alone. The fleet's other entry helper, `runMain`, is
 *   called BARE in all 449 of its callsites and must stay that way, so a rule
 *   that generalized to "every entry helper takes void" would be wrong 449
 *   times to be right once.
 */

/**
 * @type {import('eslint').Rule.RuleModule}
 */

import type { AstNode, RuleContext, RuleFixer } from '../../lib/rule-types.mts'

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require `void runHook(hook, import.meta.url)`. The dispatch scanner matches on that exact text, so a bare call silently drops the hook from the dispatch table.',
      category: 'Possible Errors',
      recommended: true,
    },
    fixable: 'code',
    messages: {
      missingVoid:
        '`runHook(...)` needs a leading `void` - the dispatch scanner matches on `void runHook(hook, import.meta.url)`, so without it this hook is dropped from the dispatch table and never runs.',
    },
    schema: [],
  },
  create(context: RuleContext) {
    return {
      ExpressionStatement(node: AstNode) {
        const { expression } = node
        // A `void`-prefixed call parses as a UnaryExpression wrapping the call,
        // so reaching here with a bare CallExpression IS the violation.
        if (!expression || expression.type !== 'CallExpression') {
          return
        }
        const { callee } = expression
        if (callee?.type !== 'Identifier' || callee.name !== 'runHook') {
          return
        }
        context.report({
          node,
          messageId: 'missingVoid',
          fix(fixer: RuleFixer) {
            return fixer.insertTextBefore(expression, 'void ')
          },
        })
      },
    }
  },
}

// Oxlint plugin contract requires default-exported rule object.
// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract
export default rule
