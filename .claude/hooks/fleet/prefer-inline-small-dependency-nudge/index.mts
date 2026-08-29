#!/usr/bin/env node
// Claude Code PreToolUse(Edit/MultiEdit/Write) hook —
// prefer-inline-small-dependency-nudge.
//
// When an edit adds a NEW `package.json` dependency (a name not present in
// `old_string`, added in `new_string`) - not a version bump of an existing
// one - this reminds the agent to check whether the package is small and
// single-purpose enough to inline its logic directly instead, the way
// `xml-parse.mts` ports `strnum`'s number-coercion branch rather than
// depending on it. See docs/agents.md/fleet/prefer-inlining-small-deps.md.
//
// PreToolUse, notify only - never blocks, always exits 0. No bypass phrase.

import path from 'node:path'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { defineHook, editGuard, notify, runHook } from '../_shared/guard.mts'

import type { ToolCallPayload } from '../_shared/payload.mts'

// A dependency-entry line inside a JSON fragment: `"name": "spec"` where
// spec looks like a real version/range/protocol, not a script command.
const DEP_ENTRY_RE =
  /"([\w@][\w@./-]*)"\s*:\s*"(?:>=?|[\^~]|\*|\d+\.|catalog:|npm:|workspace:)[^"]*"/g

/**
 * Extract dependency names declared in a `package.json` text fragment.
 * Pure + exported for direct unit testing.
 */
export function extractDependencyNames(text: string): Set<string> {
  const names = new Set<string>()
  for (const match of text.matchAll(DEP_ENTRY_RE)) {
    names.add(match[1]!)
  }
  return names
}

/**
 * Names present in `newText`'s dependency entries but absent from
 * `oldText`'s - a genuine addition, not a version bump of an existing
 * dependency. Returns an empty array when `oldText` is undefined (a Write
 * with no prior-content baseline to diff against).
 */
export function newlyAddedDependencyNames(
  oldText: string | undefined,
  newText: string,
): string[] {
  if (oldText === undefined) {
    return []
  }
  const before = extractDependencyNames(oldText)
  const after = extractDependencyNames(newText)
  return [...after].filter(name => !before.has(name))
}

function readOldString(payload: ToolCallPayload): string | undefined {
  const toolInput = payload?.tool_input as Record<string, unknown> | undefined
  const oldString = toolInput?.['old_string']
  return typeof oldString === 'string' ? oldString : undefined
}

export const check = editGuard((filePath, content, payload) => {
  if (!content) {
    return undefined
  }
  if (path.basename(normalizePath(filePath)) !== 'package.json') {
    return undefined
  }
  const added = newlyAddedDependencyNames(readOldString(payload), content)
  if (added.length === 0) {
    return undefined
  }
  return notify(
    `prefer-inline-small-dependency-nudge: new dependenc${added.length === 1 ? 'y' : 'ies'} ${added.join(', ')} - if it's small and single-purpose, consider porting the needed logic in-tree (with attribution) instead of depending on it. See docs/agents.md/fleet/prefer-inlining-small-deps.md.`,
  )
})

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'MultiEdit', 'Write'],
  scope: 'convention',
  type: 'nudge',
})

void runHook(hook, import.meta.url)
