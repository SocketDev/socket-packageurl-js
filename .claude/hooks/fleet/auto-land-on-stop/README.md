# auto-land-on-stop

**Type:** Stop hook (NUDGE - informational, never blocks).

## What it does

Fires at turn-end. Groups THIS session's authored source changes into logical
commits and lands them to local main, in EVERY repo the session touched
started in one repo, moved to another, both get their own commits. The
fleet biases toward landing often: banked work survives compaction, and a
clean tree is far less ambiguous to the next session's collision heuristics.

Safety (own-work only; the pre-mortem's blocking flaws are all closed here +
in land-work):
- Repos + paths come from the session touched-set (Edit/Write + git
add|mv|rm in the transcript), so a FOREIGN staged feature in the shared
index is never swept in. A repo the session only READ never enters.
- Each repo is landed by shelling the tested `scripts/fleet/land-work.mts
--commit <session-authored repo-relative paths>` with cwd=<repoRoot>. The
engine is resolved FLEET-FIRST (the session's own repo if it ships one,
else the wheelhouse source-of-truth) so a repo that doesn't yet carry its
own land-work still lands to local main. That run restricts to the passed
paths AND skips generated / both-touched (concurrent index+worktree, which
a `git add` would blend) / unmerged-conflict paths, and lands clean source
even mid-rebase.
- Each commit passes that repo's own pre-commit gate, broken code caught.
The staged run is scoped `related`, not full-suite, so turn-end stays fast.
- Fail-open + deterministic: a per-repo spawn is bounded; any failure skips
that repo and the hook always exits cleanly, Stop hooks must not hang.
- Skipped entirely during a cascade (`FLEET_SYNC`) or a history squash
(`SQUASH_HISTORY`) - those own their own commits.

A session that sees a commit it didn't personally issue should recognize it as
this auto-lander (see docs/agents.md/fleet/parallel-claude-sessions.md ->
"Auto-landed commits are expected"), not a rival - run `whose-work` to confirm.

## Bypass

None - it only prints informational text and cannot block or mutate anything.
