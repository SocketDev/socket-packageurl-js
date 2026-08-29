/*
 * @file Per docs/agents.md/fleet/code-style.md "Refined Record types — a
 *   Record<string, T> is a smell when the key is a path or a domain type".
 *   Reports a `Record<string, T>` annotation whose value type is a plain array
 *   or primitive, because the refined form is a Map (when the key is a path or
 *   an opaque id) or a branded key (when the key is a domain union). A bare
 *   Record<string, T> admits any string, which is how a path-typed map gains a
 *   key that is not a path. Report-only: the refined form is the caller's
 *   choice (Map for iteration order and path keys, a branded key for a closed
 *   domain).
 */

/**
 * @type {import('eslint').Rule.RuleModule}
 */

import { makeBypassChecker } from '../../lib/comment-markers.mts'
import type { AstNode, RuleContext } from '../../lib/rule-types.mts'

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Prefer a Map or a branded key over Record<string, T> when the key is a path or a domain type.',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      banned:
        'Record<string, {{value}}> admits any key; use a Map or a branded key instead.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    const hasBypassComment = makeBypassChecker(
      context,
      'socket/prefer-refined-record',
    )
    return {
      TSTypeReference(node: AstNode) {
        const typeName = node.typeName
        if (typeName?.type !== 'Identifier' || typeName.name !== 'Record') {
          return
        }
        const params = node.typeArguments?.params
        if (!Array.isArray(params) || params.length !== 2) {
          return
        }
        const [keyParam, valueParam] = params
        // Only flag string keys — a number or template-literal key is already
        // refined.
        if (
          keyParam?.type !== 'TSStringKeyword' &&
          keyParam?.typeName?.name !== 'string'
        ) {
          return
        }
        // Only flag a plain value (array or primitive) — a branded or mapped
        // value is already refined.
        const valueName =
          valueParam?.typeName?.name ??
          (valueParam?.type === 'TSArrayType'
            ? (valueParam.elementType?.typeName?.name ?? 'array')
            : undefined)
        if (valueName === undefined) {
          return
        }
        if (hasBypassComment(node)) {
          return
        }
        // A record that is JSON-serialized is exempt: a Map does not
        // JSON.stringify without a replacer, so Record is the honest shape for
        // a document. The dependency map in emit-ownership.mts is exactly that
        // case — a path-keyed record that lands on disk as JSON.
        const fileText =
          context.getSourceCode?.().text ??
          context.getSourceCode?.().getText?.() ??
          ''
        if (/JSON\.stringify|writeFileSync/.test(fileText)) {
          return
        }
        context.report({
          data: { value: valueName },
          node,
          messageId: 'banned',
        })
      },
    }
  },
}

// Oxlint plugin contract requires default-exported rule object.
// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract
export default rule
