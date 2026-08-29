# notion-replace-content-guard

**Type:** PreToolUse hook (GUARD - blocks).

## What it does

The `notion-update-page` MCP tool's `replace_content` command overwrites an
entire page, destroying Notion-specific formatting (synced blocks, colored
table rows, callout icons) that the markdown API cannot recreate. An
accidental `replace_content` wiped the SFW Unification write-up, losing its
colored PR table, blue callout blocks, and synced-block references - none
recoverable via `replace_content` with standard markdown.

This guard BLOCKS `replace_content` and steers toward the non-destructive
commands: `update_content` for targeted search-and-replace via old_str/new_str
pairs, and `insert_content` to append at a position. The other commands
`update_properties`, `apply_template`, `update_verification` pass.

Bypass: `Allow notion-replace-content bypass`.

## Bypass

Bypass slug: `notion-replace-content`. The grant phrase is typed by the operator; an agent relaying it never counts as a grant.
