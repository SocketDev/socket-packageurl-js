# active-edits-ledger

**Type:** PostToolUse hook (NUDGE - informational, never blocks).

## What it does

Fires after every Edit / Write / NotebookEdit tool call. Records the
target file path into THIS actor's per-session ledger so that:

• live-edit-collision-guard (PreToolUse, slice 2) can detect when
a DIFFERENT live actor last wrote a given path recently.
• dirty-worktree-stop-guard (slice 3) can exempt paths owned by a
live foreign actor from its blocking set.
• excuse-detector (slice 4) can gate promissory-wait patterns on
whether a live foreign actor is actually present.

This hook is the ONLY write path to the ledger - it never blocks and
exits 0 on every code path including errors. A broken recorder is
invisible (fail-open), not a session stopper.

Actor key: hash of `transcript_path` (first 16 hex chars). The
transcript_path discriminates actors because each subagent / workflow-
agent gets its own JSONL file while the main interactive session has a
different one. Keying by its hash gives a stable, content-free
filesystem key per actor - the same scheme foreign-paths.mts uses for
its same-turn ledger.

Store: `CLAUDE_PROJECT_DIR/.cache/fleet/socket-active-edits/`
(dep-0 runtime state; never tracked).

## Bypass

None - it only prints informational text and cannot block or mutate anything.
