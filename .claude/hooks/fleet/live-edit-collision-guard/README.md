# live-edit-collision-guard

**Type:** PreToolUse hook (GUARD - blocks).

## What it does

Blocks an Edit / Write / NotebookEdit operation when the target path was
written by a DIFFERENT live actor within the last 5 minutes. "Live" means
the other actor's ledger file has an updatedAt within the 15-minute TTL.

Problem observed live (#239): while a background workflow edited extension
src files, the interactive session blind-edited the same files (survived
by luck) and was then blocked for three consecutive turns by
dirty-worktree-stop-guard because the dirty paths belonged to the live run.
The collision is better caught HERE, before the write lands.

Actor key: sha256(transcript_path).slice(0,16). The transcript_path
discriminates SEPARATE interactive sessions. It does NOT discriminate a
spawned subagent from its parent - Claude Code delivers the PARENT
session's transcript_path to hooks even for a subagent's writes, so a
subagent's edits collapse into the parent actor's ledger (the stop guard
detects live children from their own transcript files instead). See the
computeActorId note in _shared/active-edits-ledger.mts.

Block message shape: name+reason line + one fact line + Fix - at most 3 content lines.

Fail-open: any IO / parse error falls through, no block, per the fleet's
hook contract - "a buggy hook silently allows" beats "a buggy hook blocks
the session."

## Bypass

Bypass slug: `live-edit-collision`. The grant phrase is typed by the operator; an agent relaying it never counts as a grant.
