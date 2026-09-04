/*
 * @file The builtins that cannot be loaded while `node --build-snapshot` runs,
 *   and the module-scope detector three surfaces share.
 *
 *   A builtin backed by a native binding registers an external reference V8
 *   cannot serialize. Requiring one at MODULE SCOPE inside a snapshotted hook
 *   aborts the snapshot build with `Unknown external reference 0x… /
 *   <unresolved>` and exit 133 — a message naming neither the module nor the
 *   hook, against a 2.9 MB pack. Loading the same builtin INSIDE a function is
 *   fine: the call runs after deserialization.
 *
 *   Consumers, all reading this one list:
 *     - `snapshot-hostile-require-guard` blocks the write.
 *     - `socket/no-snapshot-hostile-builtin` fails the lint.
 *     - `scripts/fleet/hooks/snapshot-hostile-builtins.mts` names the offender
 *       in a build that already aborted.
 */

import { tryParse } from './ast/core.mts'

import type { AcornNode } from './ast/core.mts'

/**
 * Measured, not guessed: each entry aborts `--build-snapshot` when required at
 * module scope. Node prints its own "not yet fully verified whether built-in
 * module X works in user snapshot builder scripts" warning for these.
 */
export const SNAPSHOT_HOSTILE_BUILTINS: readonly string[] = ['node:sqlite']

/**
 * Every spelling of a builtin specifier a source file can use: `node:sqlite`
 * and the bare `sqlite`, since `require('sqlite')` resolves to the builtin too.
 */
export function builtinSpellings(builtin: string): string[] {
  const bare = builtin.startsWith('node:') ? builtin.slice(5) : builtin
  return [builtin, bare]
}

export interface HostileImport {
  /**
   * The specifier as written, so the report quotes the source rather than a
   * canonical form the author never typed.
   */
  specifier: string
  /**
   * 1-indexed line of the offending statement.
   */
  line: number
}

/**
 * The node types whose bodies run AFTER deserialization, so a hostile load
 * inside one is safe. The walk stops at these.
 */
const FUNCTION_TYPES: ReadonlySet<string> = new Set([
  'ArrowFunctionExpression',
  'FunctionDeclaration',
  'FunctionExpression',
])

/**
 * Find module-scope loads of a snapshot-hostile builtin. Parses the source and
 * walks only the statements that run at module eval: an `import` declaration is
 * always one, and a `require()` / `process.getBuiltinModule()` counts only when
 * no function body encloses it. Returns an empty list for source that does not
 * parse, so a syntax error in an editor buffer never reads as a violation.
 */
export function findModuleScopeHostileLoads(source: string): HostileImport[] {
  const hostile = new Set(
    SNAPSHOT_HOSTILE_BUILTINS.flatMap(builtin => builtinSpellings(builtin)),
  )
  // Cheap gate: every spelling must appear verbatim for any match, so the
  // common clean file skips the parse entirely.
  if (![...hostile].some(spelling => source.includes(spelling))) {
    return []
  }
  const tree = tryParse(source)
  if (tree === undefined) {
    return []
  }
  const found: HostileImport[] = []
  const lineOf = (node: AcornNode): number => {
    const start = typeof node.start === 'number' ? node.start : 0
    let line = 1
    for (let i = 0; i < start && i < source.length; i += 1) {
      if (source[i] === '\n') {
        line += 1
      }
    }
    return line
  }
  const record = (node: AcornNode, specifier: string): void => {
    if (hostile.has(specifier)) {
      found.push({ line: lineOf(node), specifier })
    }
  }
  const visit = (node: unknown): void => {
    if (node === null || typeof node !== 'object') {
      return
    }
    if (Array.isArray(node)) {
      for (let i = 0, { length } = node; i < length; i += 1) {
        visit(node[i])
      }
      return
    }
    const current = node as AcornNode & Record<string, unknown>
    const type = typeof current['type'] === 'string' ? current['type'] : ''
    // A function body runs post-deserialize; nothing inside it is a violation.
    if (FUNCTION_TYPES.has(type)) {
      return
    }
    const specifier = moduleScopeLoadSpecifier(current, type)
    if (specifier !== undefined) {
      record(current, specifier)
    }
    const keys = Object.keys(current)
    for (let i = 0, { length } = keys; i < length; i += 1) {
      const key = keys[i]!
      if (isNodePositionKey(key)) {
        continue
      }
      visit(current[key])
    }
  }
  visit(tree)
  return found
}

/**
 * True for the keys every acorn node carries that hold a number rather than a
 * child node, so the walk never descends into them.
 */
export function isNodePositionKey(key: string): boolean {
  return key === 'end' || key === 'start' || key === 'type'
}

/**
 * The specifier an `import` declaration loads at runtime, or undefined when it
 * loads nothing. A type-only import is erased at compile time, so it is the
 * sanctioned way to keep the type while deferring the load: `importKind` is
 * `type` for `import type …`, `value` otherwise.
 */
export function importDeclarationSpecifier(
  node: AcornNode & Record<string, unknown>,
): string | undefined {
  if (node['importKind'] === 'type') {
    return undefined
  }
  const value = (node['source'] as { value?: unknown | undefined } | undefined)
    ?.value
  return typeof value === 'string' ? value : undefined
}

/**
 * The specifier a builtin-loading call takes, or undefined when the call loads
 * no statically-known builtin.
 */
export function builtinLoaderCallSpecifier(
  node: AcornNode & Record<string, unknown>,
): string | undefined {
  if (!isBuiltinLoader(node)) {
    return undefined
  }
  const args = node['arguments']
  const first = Array.isArray(args) ? args[0] : undefined
  const value = (first as { value?: unknown | undefined } | undefined)?.value
  return typeof value === 'string' ? value : undefined
}

/**
 * The builtin specifier a statement loads, or undefined when it loads nothing.
 * The caller has already refused to enter a function body, so every node
 * reaching here runs at module eval.
 */
export function moduleScopeLoadSpecifier(
  node: AcornNode & Record<string, unknown>,
  type: string,
): string | undefined {
  if (type === 'ImportDeclaration' || type === 'ImportExpression') {
    return importDeclarationSpecifier(node)
  }
  if (type === 'CallExpression') {
    return builtinLoaderCallSpecifier(node)
  }
  return undefined
}

/**
 * True when the call expression loads a builtin: bare `require(…)`, or a
 * `process.getBuiltinModule(…)` member call. Both take the specifier first.
 */
export function isBuiltinLoader(call: AcornNode): boolean {
  const callee = (call as AcornNode & { callee?: unknown | undefined })
    .callee as
    | (AcornNode & {
        name?: unknown | undefined
        property?: unknown | undefined
      })
    | undefined
  if (callee === undefined) {
    return false
  }
  if (callee.name === 'require') {
    return true
  }
  const property = callee.property as { name?: unknown | undefined } | undefined
  return property?.name === 'getBuiltinModule'
}
