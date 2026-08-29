#!/usr/bin/env node
// Claude Code PreToolUse hook — notion-replace-content-guard.
//
// The `notion-update-page` MCP tool's `replace_content` command overwrites an
// entire page, destroying Notion-specific formatting (synced blocks, colored
// table rows, callout icons) that the markdown API cannot recreate. An
// accidental `replace_content` wiped the SFW Unification write-up, losing its
// colored PR table, blue callout blocks, and synced-block references - none
// recoverable via `replace_content` with standard markdown.
//
// This guard BLOCKS `replace_content` and steers toward the non-destructive
// commands: `update_content` for targeted search-and-replace via old_str/new_str
// pairs, and `insert_content` to append at a position. The other commands
// `update_properties`, `apply_template`, `update_verification` pass.
//
// Bypass: `Allow notion-replace-content bypass`.

import { isPlainObject } from '@socketsecurity/lib-stable/objects/predicates'

import { block, defineHook, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

const BYPASS_PHRASE = 'Allow notion-replace-content bypass'

// Matches the Notion update-page MCP tool across install prefixes:
// mcp__claude_ai_Notion__notion-update-page, mcp__Notion__notion-update-page.
const NOTION_UPDATE_PAGE_RE = /notion__notion-update-page$/i

/**
 * True when the tool name is the Notion update-page MCP tool (any install
 * prefix). The regex anchors on the tool suffix, not the server segment, so it
 * survives a prefix rename.
 */
export function isNotionUpdatePage(toolName: string | undefined): boolean {
  return typeof toolName === 'string' && NOTION_UPDATE_PAGE_RE.test(toolName)
}

/**
 * The verdict: block `replace_content` on `notion-update-page`. The command
 * overwrites the entire page and destroys Notion-specific formatting that the
 * markdown API cannot recreate. `update_content` (search-and-replace) and
 * `insert_content` (append) are the safe alternatives.
 */
export function findReplaceContentBlock(payload: ToolCallPayload): GuardResult {
  if (!isNotionUpdatePage(payload.tool_name)) {
    return undefined
  }
  const input = payload.tool_input
  if (!isPlainObject(input)) {
    return undefined
  }
  const command = input['command']
  if (command !== 'replace_content') {
    return undefined
  }
  if (bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)) {
    return undefined
  }
  return block(
    `notion-replace-content-guard: blocked notion-update-page replace_content - it overwrites the entire page.\n` +
      `  Saw:    command: "replace_content" on page_id: ${String(input['page_id'] ?? '?')}.\n` +
      `  Rule:   replace_content destroys Notion-specific formatting (synced blocks, colored\n` +
      `          table rows, callout icons) that the markdown API cannot recreate. An\n` +
      `          accidental replace_content wiped a full write-up this way.\n` +
      `  Fix:    use update_content (targeted old_str/new_str search-and-replace) or\n` +
      `          insert_content (append at a position) instead. Bypass: \`${BYPASS_PHRASE}\`.`,
  )
}

export const check = (payload: ToolCallPayload): GuardResult =>
  findReplaceContentBlock(payload)

export const hook = defineHook({
  bypass: ['notion-replace-content'],
  check,
  event: 'PreToolUse',
  type: 'guard',
})

void runHook(hook, import.meta.url)
