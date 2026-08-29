#!/usr/bin/env node
// Claude Code PreToolUse hook — snapshot-hostile-require-guard.
//
// Blocks an Edit/Write/MultiEdit that loads a snapshot-hostile builtin at
// MODULE SCOPE inside a file the V8 startup snapshot bundles. Such a builtin is
// backed by a native binding, which registers an external reference V8 cannot
// serialize, so `node --build-snapshot` aborts with `Unknown external reference
// 0x… / <unresolved>` and exit 133 — naming neither the module nor the hook.
//
// The build-time reporter (scripts/fleet/_shared/snapshot-hostile-builtins.mts)
// names the offender AFTER the abort. This one refuses the keystroke, while the
// author still has the context to fix it cheaply.
//
// Scope: the snapshot bundles the fleet hook tree plus the shared script
// modules those hooks import, so the guard covers `.claude/hooks/fleet/**` and
// `scripts/fleet/_shared/**`. A hook marked `@dispatch-snapshot-exclude` ships
// in the sibling runtime bundle instead, so it is exempt. A load INSIDE a
// function body runs after deserialization and passes.
//
// Exit codes:
//   0 — pass, not an edit tool, out of scope, or every load sits in a function.
//   2 — block (a module-scope load of a hostile builtin).
//
// Fails open on malformed payloads (exit 0 + stderr log).

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'
import { findModuleScopeHostileLoads } from '../_shared/snapshot-hostile-builtins.mts'

import type { GuardResult } from '../_shared/guard.mts'
import { verdictLine } from '../_shared/verdict.mts'

const SNAPSHOT_EXCLUDE_MARKER = '@dispatch-snapshot-exclude'

/**
 * The two trees the snapshot bundle reads: every fleet hook, and the shared
 * script modules a hook can import. Matched on a normalized path so a
 * Windows-style separator cannot dodge the check.
 */
const IN_SNAPSHOT_GRAPH: readonly RegExp[] = [
  /(?:^|\/)\.claude\/hooks\/fleet\/[^/]+\/[^/]+\.mts$/,
  /(?:^|\/)scripts\/fleet\/_shared\/[^/]+\.mts$/,
]

/**
 * True when the edited path sits in the snapshot graph. A `_shared` module
 * counts: a hostile load there reaches every hook importing it.
 */
export function isSnapshotGraphPath(filePath: string): boolean {
  const unixPath = filePath.replaceAll('\\', '/')
  return IN_SNAPSHOT_GRAPH.some(pattern => pattern.test(unixPath))
}

/**
 * True when the hook owning this path opted out of the snapshot. The marker
 * lives in the hook's own `index.mts`, so a sibling module inherits it.
 */
export function isSnapshotExcluded(filePath: string): boolean {
  const indexPath = path.join(path.dirname(filePath), 'index.mts')
  if (!existsSync(indexPath)) {
    return false
  }
  try {
    return readFileSync(indexPath, 'utf8').includes(SNAPSHOT_EXCLUDE_MARKER)
  } catch {
    return false
  }
}

/**
 * The verdict for one edit: the written content is parsed, and a module-scope
 * load of a hostile builtin blocks. Content that does not parse passes — an
 * in-progress buffer is not a violation.
 */
export function checkEdit(
  filePath: string,
  content: string | undefined,
): GuardResult {
  const text = content ?? ''
  if (
    text === '' ||
    !isSnapshotGraphPath(filePath) ||
    isSnapshotExcluded(filePath)
  ) {
    return undefined
  }
  const loads = findModuleScopeHostileLoads(text)
  if (loads.length === 0) {
    return undefined
  }
  const first = loads[0]!
  return block(
    [
      verdictLine(
        'block',
        'snapshot-hostile-require-guard',
        `'${first.specifier}' loads at module scope.`,
      ),
      `  where: ${filePath}:${first.line}`,
      '  saw:   a builtin backed by a native binding, loaded while the module evaluates',
      '  want:  the load deferred into a function body, so it runs after deserialization',
      '',
      '  The snapshot build evaluates every bundled module, and a native binding',
      '  registers an external reference V8 cannot serialize. The build aborts with',
      '  "Unknown external reference 0x… / <unresolved>" and exit 133, naming',
      '  neither the module nor the hook.',
      '',
      '  Fix, either one:',
      '    - move the load inside the function that uses it:',
      `        const { X } = process.getBuiltinModule('${first.specifier}')`,
      `    - mark the hook ${SNAPSHOT_EXCLUDE_MARKER} when it genuinely needs the`,
      '      builtin at load time; it then ships in the excluded bundle.',
      '',
    ].join('\n'),
  )
}

export const check = editGuard((filePath, content) =>
  checkEdit(filePath, content),
)

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'Write', 'MultiEdit'],
  scope: 'convention',
  type: 'guard',
})

void runHook(hook, import.meta.url)
