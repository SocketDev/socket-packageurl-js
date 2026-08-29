/*
 * @file Forbid a MODULE-SCOPE load of a snapshot-hostile builtin in a file the
 *   V8 startup snapshot bundles. Third surface of one rule, beside the
 *   `snapshot-hostile-require-guard` edit-time hook and the build-time reporter
 *   in `scripts/fleet/_shared/snapshot-hostile-builtins.mts` — code is law.
 *
 *   A builtin backed by a native binding registers an external reference V8
 *   cannot serialize, so loading one while a bundled module evaluates aborts
 *   `node --build-snapshot` with `Unknown external reference 0x… /
 *   <unresolved>` and exit 133, naming neither the module nor the hook. The
 *   incident: `node:sqlite` reached the pack from
 *   `scripts/fleet/_shared/socket-state.mts` and cost a bisect of the whole
 *   hook set to find.
 *
 *   The same load inside a function body is fine: it runs after
 *   deserialization. No autofix — hoisting a load into the right function is a
 *   judgment call about which function, so the rewrite stays the author's.
 */

import { SNAPSHOT_HOSTILE_BUILTINS } from '../../../../../.claude/hooks/fleet/_shared/snapshot-hostile-builtins.mts'

import type { AstNode, RuleContext } from '../../lib/rule-types.mts'

/**
 * Every spelling a source file can use for a hostile builtin: the `node:` form
 * and the bare name, since `require('sqlite')` resolves to the builtin too.
 */
const HOSTILE_SPECIFIERS: ReadonlySet<string> = new Set(
  SNAPSHOT_HOSTILE_BUILTINS.flatMap(builtin => [
    builtin,
    builtin.startsWith('node:') ? builtin.slice(5) : builtin,
  ]),
)

/**
 * The files the snapshot bundles: every fleet hook, plus the shared script
 * modules a hook can import. A `_shared` module counts because a hostile load
 * there reaches every hook importing it.
 */
const IN_SNAPSHOT_GRAPH: readonly RegExp[] = [
  /(?:^|\/)\.claude\/hooks\/fleet\/[^/]+\/[^/]+\.mts$/,
  /(?:^|\/)scripts\/fleet\/_shared\/[^/]+\.mts$/,
]

/**
 * True when the file is snapshot-bundled: a fleet-default path, or one under
 * a prefix this repo declared. Prefixes are matched against the file's
 * repo-relative path, so `src/` covers `src/state/db.mts`.
 */
export function isSnapshotGraphFile(
  filename: string,
  extraPrefixes: readonly string[] = [],
): boolean {
  const unixPath = filename.replaceAll('\\', '/')
  if (IN_SNAPSHOT_GRAPH.some(pattern => pattern.test(unixPath))) {
    return true
  }
  for (let i = 0, { length } = extraPrefixes; i < length; i += 1) {
    const prefix = extraPrefixes[i]!.replace(/\*+$/, '')
    if (prefix !== '' && unixPath.includes(prefix)) {
      return true
    }
  }
  return false
}

/**
 * The node types whose bodies run AFTER deserialization, so a load inside one
 * is safe. Tracked with enter/exit visitors rather than an ancestor walk: the
 * oxlint plugin runtime hands a rule no ancestor chain, and a rule that asks
 * for one reads every in-function load as module scope.
 */
export const FUNCTION_TYPES: readonly string[] = [
  'ArrowFunctionExpression',
  'FunctionDeclaration',
  'FunctionExpression',
]

/**
 * True when the call loads a builtin: bare `require(…)` or a
 * `process.getBuiltinModule(…)` member call. Both take the specifier first.
 */
export function isBuiltinLoaderCall(node: AstNode): boolean {
  const callee = (
    node as {
      callee?:
        | { name?: unknown | undefined; property?: unknown | undefined }
        | undefined
    }
  ).callee
  if (!callee) {
    return false
  }
  if (callee.name === 'require') {
    return true
  }
  const property = callee.property as { name?: unknown | undefined } | undefined
  return property?.name === 'getBuiltinModule'
}

export function firstStringArg(node: AstNode): string | undefined {
  const args = (node as { arguments?: unknown | undefined }).arguments
  const first = Array.isArray(args) ? args[0] : undefined
  const value = (first as { value?: unknown | undefined } | undefined)?.value
  return typeof value === 'string' ? value : undefined
}

/**
 * The repo's declared extra scopes, from this rule's own options. A rule
 * invoked with no options (the fleet default) reads as an empty list, so the
 * fleet scope stands alone.
 */
export function readExtraScopes(context: RuleContext): readonly string[] {
  const options = (context as { options?: unknown | undefined }).options
  const first = Array.isArray(options) ? options[0] : undefined
  const scopes = (first as { extraScopes?: unknown | undefined } | undefined)
    ?.extraScopes
  return Array.isArray(scopes)
    ? scopes.filter((scope): scope is string => typeof scope === 'string')
    : []
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid a module-scope load of a snapshot-hostile builtin (node:sqlite) in a file the V8 startup snapshot bundles; it aborts --build-snapshot with an unnamed external reference.',
      category: 'Possible Errors',
      recommended: true,
    },
    // `extraScopes` is how a repo widens the scope from its OWN lint config
    // (`.config/repo/oxlint.config.mts`), which is where per-repo lint
    // decisions live. The fleet default covers what the FLEET snapshots; a
    // library whose dist lands inside a consumer snapshot needs its own
    // sources covered too, and only that repo knows it.
    schema: [
      {
        type: 'object',
        properties: {
          extraScopes: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      moduleScopeLoad:
        "`{{specifier}}` loads at module scope — a native binding V8 cannot serialize, so `node --build-snapshot` aborts with 'Unknown external reference'. Move the load inside the function that uses it (`process.getBuiltinModule('{{specifier}}')`), or mark the hook @dispatch-snapshot-exclude.",
    },
  },

  create(context: RuleContext) {
    const filename = context.getFilename
      ? context.getFilename()
      : (context.filename ?? '')
    const extraScopes = readExtraScopes(context)
    if (!isSnapshotGraphFile(String(filename), extraScopes)) {
      return {}
    }
    // Depth of the function bodies enclosing the current node. Only a load at
    // depth 0 evaluates during the snapshot build.
    let functionDepth = 0
    const report = (node: AstNode, specifier: string): void => {
      context.report({
        node,
        messageId: 'moduleScopeLoad',
        data: { specifier },
      })
    }
    return {
      // An import declaration always runs at module eval, so no ancestor check
      // applies.
      ImportDeclaration(node: AstNode) {
        // `import type` is erased before the bundle exists, so it never loads
        // the binding. Reporting it would leave the correct code with no way to
        // name the type it returns.
        if (
          (node as { importKind?: unknown | undefined }).importKind === 'type'
        ) {
          return
        }
        const value = (
          node as { source?: { value?: unknown | undefined } | undefined }
        ).source?.value
        if (typeof value === 'string' && HOSTILE_SPECIFIERS.has(value)) {
          report(node, value)
        }
      },
      CallExpression(node: AstNode) {
        if (!isBuiltinLoaderCall(node)) {
          return
        }
        const specifier = firstStringArg(node)
        if (specifier === undefined || !HOSTILE_SPECIFIERS.has(specifier)) {
          return
        }
        if (functionDepth > 0) {
          return
        }
        report(node, specifier)
      },
      ...Object.fromEntries(
        FUNCTION_TYPES.flatMap(type => [
          [
            type,
            () => {
              functionDepth += 1
            },
          ],
          [
            `${type}:exit`,
            () => {
              functionDepth -= 1
            },
          ],
        ]),
      ),
    }
  },
}

// Oxlint plugin contract requires default-exported rule object.
// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract
export default rule
