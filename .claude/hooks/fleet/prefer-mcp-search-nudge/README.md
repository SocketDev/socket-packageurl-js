# prefer-mcp-search-nudge

**Type:** PreToolUse hook (NUDGE - informational, never blocks).

## What it does

The fff MCP server is wired in `.mcp.json`, so `mcp__fff__grep`,
`mcp__fff__find_files`, and `mcp__fff__multi_grep` are available in every
session. Being available is not the same as being used: a session that
reached for Bash + `rg` 603 times called the MCP tools zero times, and its
searches carried costs the structured tools do not have.

Three of those costs are concrete:
- Short-flag clusters corrupt silently. `rg -rn pattern` parses as
`--replace 'n'` and prints every match as `n` while still exiting 0, which
is why `rg-replace-flag-guard` exists. A structured call has no flag
string to fumble.
- Case and naming variants become several sequential calls, where
`multi_grep` takes them in one.
- Frecency ranking is lost. fff boosts git-dirty and recently-touched
files, which is exactly the ordering that helps in a tree another actor is
actively writing.

Stderr reminder; never blocks. `rg` remains correct for the cases the MCP
tools cannot serve, and the carve-outs below encode those.

Scope: Bash tool only. It nudges ONLY a search standing at the head of its
own pipeline, because that is the shape the MCP tools replace. Skipped:
- a search DOWNSTREAM of a pipe (`cmd | rg pattern`) - it filters another
command's stdout, which no file-search tool can do;
- `find` carrying `-delete` or `-exec` - that performs an operation rather
than answering a question;
- `--version` / `--help` probes.

## Bypass

None - it only prints informational text and cannot block or mutate anything.
