# notion-backup-nudge

**Type:** PreToolUse hook (NUDGE - informational, never blocks).

## What it does

A non-blocking companion to notion-replace-content-guard. Before ANY
notion-update-page call, nudge the agent to notion-fetch the page first so
the current content is backed up in the transcript. Notion's revision
history is the ultimate fallback, but a fetched copy is immediate and
survives a session that can't reach the Notion UI to restore from
revisions. The nudge fires on every command - update_content,
insert_content, update_properties - not just the destructive
replace_content the guard blocks.

## Bypass

None - it only prints informational text and cannot block or mutate anything.
