#!/usr/bin/env node
// Claude Code PreToolUse hook — notion-backup-nudge.
//
// A non-blocking companion to notion-replace-content-guard. Before ANY
// notion-update-page call, nudge the agent to notion-fetch the page first so
// the current content is backed up in the transcript. Notion's revision
// history is the ultimate fallback, but a fetched copy is immediate and
// survives a session that can't reach the Notion UI to restore from
// revisions. The nudge fires on every command — update_content,
// insert_content, update_properties — not just the destructive
// replace_content the guard blocks.

import { isPlainObject } from '@socketsecurity/lib-stable/objects/predicates'

import { defineHook, notify, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'
import { NOTION_BACKUPS_DIR } from '../_shared/paths.mts'

// Matches the Notion update-page MCP tool across install prefixes.
const NOTION_UPDATE_PAGE_RE = /notion__notion-update-page$/i

/**
 * True when the tool name is the Notion update-page MCP tool (any install
 * prefix). Shared shape with notion-replace-content-guard.
 */
export function isNotionUpdatePage(toolName: string | undefined): boolean {
  return typeof toolName === 'string' && NOTION_UPDATE_PAGE_RE.test(toolName)
}

/**
 * The nudge: before any notion-update-page call, remind the agent to
 * notion-fetch the page first so the current content is in the transcript as
 * a backup. Non-blocking — the call proceeds regardless.
 */
export function findBackupNudge(payload: ToolCallPayload): GuardResult {
  if (!isNotionUpdatePage(payload.tool_name)) {
    return undefined
  }
  const input = payload.tool_input
  const pageId = isPlainObject(input) ? String(input['page_id'] ?? '?') : '?'
  return notify(
    `notion-backup-nudge: Back up before modifying: notion-fetch page ${pageId}, then save the content to ${NOTION_BACKUPS_DIR}/${pageId}.md before calling notion-update-page. The transcript fetch is ephemeral; the file persists across sessions as a restore source. Notion's revision history is the UI fallback.`,
  )
}

export const check = (payload: ToolCallPayload): GuardResult =>
  findBackupNudge(payload)

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  type: 'nudge',
})

void runHook(hook, import.meta.url)
