# attribution-rewrite-nudge

**Type:** PreToolUse hook (NUDGE - informational, never blocks).

## What it does

Hand-scripted `git rebase -i` message rewrites - a Bash command that sets
GIT_SEQUENCE_EDITOR and/or GIT_EDITOR around a rebase to reword commits -
are quoting-fragile, silently no-op when the todo regex misses its line,
and verify nothing afterward. All three failure modes happened live
(socket-mcp, 2026-07-10) while trying to strip an AI-attribution trailer.

The deterministic owner is `scripts/fleet/strip-ai-tags.mts`:
plumbing-based, rewords only flagged messages, preserves trees + author
identity + dates, re-signs, and verifies the final tree byte-identical.

Fires on the combination (scripted editor env var + a `git rebase`
invocation) in one Bash command. Stderr reminder; never blocks - a
scripted-editor rebase has legitimate uses beyond message rewrites (todo
reordering, autosquash), so the nudge routes rather than gates.

Sibling: `history-rewrite-guard` BLOCKS the raw rewrite tools -
`git filter-branch`, `git filter-repo`, and an unsigned `git commit-tree` -
which have no safe fleet use. The split is by severity of the trigger: a
scripted-editor rebase is sometimes right (nudge, here), `filter-branch`
never is (guard, there). Detail: docs/agents.md/fleet/history-rewrites.md

## Bypass

None - it only prints informational text and cannot block or mutate anything.
