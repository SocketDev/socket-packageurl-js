/*
 * @file Per docs/fleet/agents.md/code-style.md "Refined Record types — a
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

/**
 * True when the Record key parameter is a bare `string`. A number or a
 * template-literal key is already refined, so it is never flagged.
 */
function isBareStringRecordKey(keyParam: AstNode | undefined): boolean {
  return (
    keyParam?.type === 'TSStringKeyword' ||
    keyParam?.typeName?.name === 'string'
  )
}

/**
 * Name the Record value type when it is a plain value (array or primitive).
 * Returns undefined for a branded or mapped value, which is already refined.
 */
function resolveRecordValueTypeName(
  valueParam: AstNode | undefined,
): string | undefined {
  return (
    valueParam?.typeName?.name ??
    (valueParam?.type === 'TSArrayType'
      ? (valueParam.elementType?.typeName?.name ?? 'array')
      : undefined)
  )
}

/**
 * True when the linted file serializes to JSON anywhere. A record that is
 * JSON-serialized is exempt: a Map does not JSON.stringify without a replacer,
 * so Record is the honest shape for a document. The dependency map in
 * emit-ownership.mts is exactly that case — a path-keyed record that lands on
 * disk as JSON.
 */
function fileSerializesJson(context: RuleContext): boolean {
  const fileText =
    context.getSourceCode?.().text ??
    context.getSourceCode?.().getText?.() ??
    ''
  // Either the JSON.stringify call itself or the writeFileSync that lands it.
  return /JSON\.stringify|writeFileSync/.test(fileText)
}

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
        const { 0: keyParam, 1: valueParam } = params
        if (!isBareStringRecordKey(keyParam)) {
          return
        }
        const valueName = resolveRecordValueTypeName(valueParam)
        if (valueName === undefined) {
          return
        }
        if (hasBypassComment(node)) {
          return
        }
        if (fileSerializesJson(context)) {
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
