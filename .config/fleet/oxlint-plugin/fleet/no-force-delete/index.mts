/*
 * @file `force: true` on a delete disables the only guard standing between a
 *   wrong path and an unrecoverable loss, so it needs a stated reason.
 *
 *   `safeDelete` protects the current working directory and everything above
 *   it. `force: true` turns that off. Inside the OS temp dir, the cacache, and
 *   the Socket user dir the protection is lifted automatically, so a scratch
 *   cleanup never needs the flag - which means a hand-written `force: true` is
 *   almost always either redundant or the dangerous case.
 *
 *   Measured: `force` used to DEFAULT to true in the lib, so every caller ran
 *   unprotected and `safeDelete(dirAboveCwd)` removed a working checkout without
 *   a word. The default is opt-in now; this rule keeps the flag rare and
 *   deliberate rather than ambient.
 *
 *   The escape is the standard per-line disable WITH a reason:
 *     // oxlint-disable-next-line socket/no-force-delete -- <why>
 *
 *   Not autofixable: whether a delete legitimately needs to cross the cwd
 *   boundary is a judgment about the caller, not a mechanical rewrite.
 */

import type { AstNode, RuleContext } from '../../lib/rule-types.mts'

// The del-backed entry points ONLY. `force` means two different things
// depending on who reads it: for these it lifts the cwd-and-above guard, but for
// node's own `fs.rm`/`rmSync` it only means "tolerate a missing path" and
// bypasses nothing. Flagging node's spelling would demand a reason comment for
// an ENOENT tolerance, which teaches the reader that the marker is noise. The
// recursive-delete risk in node's API is `recursive: true` on an unvalidated
// path, which `socket/prefer-safe-delete` already routes through safeDelete.
const DELETE_CALLEES: ReadonlySet<string> = new Set([
  'deleteAsync',
  'deleteSync',
  'safeDelete',
  'safeDeleteSync',
])

/**
 * The callee's plain name, for `fn(…)` and `obj.fn(…)` alike.
 */
export function calleeName(node: AstNode): string | undefined {
  const callee = (node as { callee?: unknown | undefined }).callee as
    | {
        name?: string | undefined
        property?: { name?: string | undefined } | undefined
        type?: string | undefined
      }
    | undefined
  if (!callee) {
    return undefined
  }
  if (callee.type === 'Identifier') {
    return callee.name
  }
  if (callee.type === 'MemberExpression') {
    return callee.property?.name
  }
  return undefined
}

/**
 * The `force: true` property node inside `arg`, or undefined. Returning the
 * NODE rather than a boolean is what lets the report land on the property: a
 * finding anchored to the whole call cannot be silenced by a comment above the
 * flag, which is where a reader looks for it.
 *
 * A computed key, a spread, or a non-literal value reads as unknown and is left
 * alone: this rule reports what it can prove, so a false positive never costs a
 * reason comment.
 */
export function forceTrueProperty(
  arg: AstNode | undefined,
): AstNode | undefined {
  if (!arg) {
    return undefined
  }
  const expression = arg as {
    properties?:
      | Array<{
          computed?: boolean | undefined
          key?:
            | { name?: string | undefined; value?: unknown | undefined }
            | undefined
          type?: string | undefined
          value?:
            | { value?: unknown | undefined; type?: string | undefined }
            | undefined
        }>
      | undefined
    type?: string | undefined
  }
  if (expression.type !== 'ObjectExpression') {
    return undefined
  }
  for (const property of expression.properties ?? []) {
    if (property.type !== 'Property' || property.computed) {
      continue
    }
    const key = property.key?.name ?? property.key?.value
    if (key !== 'force') {
      continue
    }
    if (property.value?.type === 'Literal' && property.value.value === true) {
      return property as unknown as AstNode
    }
  }
  return undefined
}

const rule = {
  meta: {
    docs: {
      description:
        'a delete with `force: true` bypasses the cwd guard and must state why',
    },
    messages: {
      forced:
        '`force: true` on `{{callee}}` disables the cwd-and-above delete guard. Drop it (temp, cacache, and the Socket user dir are already exempt), or keep it behind `// oxlint-disable-next-line socket/no-force-delete -- <why>`.',
    },
    schema: [],
    type: 'problem',
  },
  create(context: RuleContext) {
    return {
      CallExpression(node: AstNode) {
        const name = calleeName(node)
        if (!name || !DELETE_CALLEES.has(name)) {
          return
        }
        const args = ((node as { arguments?: AstNode[] | undefined })
          .arguments ?? []) as AstNode[]
        // The options bag is any argument after the path.
        for (let i = 1, { length } = args; i < length; i += 1) {
          const property = forceTrueProperty(args[i])
          if (property) {
            context.report({
              node: property,
              messageId: 'forced',
              data: { callee: name },
            })
            return
          }
        }
      },
    }
  },
}

// Oxlint plugin contract requires default-exported rule object.
// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract
export default rule
