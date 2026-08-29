# avoid-cd-nudge

**Type:** PreToolUse hook (NUDGE - informational, never blocks).

## What it does

The Bash tool's working directory PERSISTS across tool calls. That's
useful for chaining commands but easy to lose track of: a `cd` in
turn N puts every later command in a different cwd until something
resets it. The assistant has burned multiple tool calls realizing
cwd had drifted - see e.g. "Wait - patch ran from current dir.
But the current dir isn't lsquic upstream."

The fix is one of:
(a) prefer absolute paths inside a single command - no cd needed:
patch --dry-run -p1 -d /abs/path/to/source < /abs/path/to/file.patch
(b) keep the cd local to the command via `()` subshell - pwd is
confined to the subshell, parent cwd unchanged:
(cd /abs/path && make)
(c) end the command with `&& pwd` so the next tool call shows
evidence in the log where the cwd actually ended up:
cd /abs/path && some-command && pwd

This hook fires on Bash commands that contain a bare `cd <path>`
without one of the above safeguards. Stderr reminder; never blocks.

Scope: Bash tool only. Skips:
- `cd ` inside a `()` subshell (pattern (b) - safe)
- `cd ` followed by `&& pwd` or `; pwd` at the end (pattern (c) -
evidenced)
- `cd -`, return to previous dir, intentional
- `cd <path> 2>/dev/null` short forms used for existence probes
caller knows what they're doing

## Bypass

None - it only prints informational text and cannot block or mutate anything.
