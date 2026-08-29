# no-cascade-transient-git-guard

**Type:** PreToolUse hook (GUARD - blocks).

## What it does

Blocks a cascade-shaped `git commit` when the target repo is in a
transient git state - detached HEAD or in-progress rebase / merge /
cherry-pick. Committing in that state lands the cascade on a stale or
throwaway ref instead of the branch tip, stranding the commit and
corrupting another session's in-flight operation.

Why this exists: 2026-06-02 a fleet cascade's manual commit loop ran
`git commit -m "chore(wheelhouse): cascade template@<sha>"` across
every fleet repo. socket-lib was mid-`git cherry-pick` on a detached
HEAD, another session's work; the loop ignored that and committed the
cascade onto the detached HEAD, breaking the cherry-pick sequencer.
sync-scaffolding's own auto-commit already skips this state - but a
hand-typed loop bypassed that check. This hook enforces it at the Bash
layer so NO commit path, script, loop, or manual, can land a cascade on
a transient ref.

Skipped silently:
- tool_name !== 'Bash'.
- Command isn't a cascade-prefixed `git commit`.
- Target repo is on a normal branch tip, the common case.

No bypass: there is never a legitimate reason to land a cascade commit
on a transient ref. Finish, or abort, the in-progress operation first.

Exit codes:
0  - allow.
2  - block. Stderr carries the operator-facing message.

Fails open on any internal error (exit 0 + stderr log).

## Bypass

None.
