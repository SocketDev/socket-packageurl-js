# Mode 4: `land`

Move already-verified commits onto `origin/<default>` with the least ceremony that's still safe. This is the fast path for two cases: the primary checkout's branch has **diverged** from origin, because a parallel session squashed your commits onto origin via PR, leaving your local with unsquashable duplicates; or the branch is **actively churned** by another session, so a direct `git push` would be rejected and a `reset --hard` would discard that session's work.

The fleet **lints as it edits**, so a commit's diff already passed the gates the pre-commit / pre-push hooks re-run. Re-running them on land is ceremony that can block or crash. A pre-commit staged-test run hung 55 min in practice, and a fresh worktree has no `node_modules`, so the lib-importing pre-push hooks throw `ERR_MODULE_NOT_FOUND`. Mode 4 replaces the manual cherry-pick → fast-forward dance with one command: it re-asserts the lint gate on the landing diff (fast, deterministic, NOT a heavy test re-run), cherry-picks the commits onto a throwaway worktree branched off `origin/<base>` (a clean tree), confirms a clean fast-forward, then fast-forwards `origin/<base>`. NEVER force-pushes; if origin moved since, it aborts and tells you to re-run.

```bash
# Dry-run (default): plan + re-assert the lint gate, don't push.
node .claude/skills/fleet/managing-worktrees/lib/land.mts --last 2

# Act: fast-forward origin/<base> to the last 2 commits of HEAD.
node .claude/skills/fleet/managing-worktrees/lib/land.mts --last 2 --push

# Land explicit SHAs (oldest-first cherry-pick order).
node .claude/skills/fleet/managing-worktrees/lib/land.mts <sha-a> <sha-b> --push

# Land onto LOCAL <base> (no push) — fast-forwards the primary checkout's
# branch; the tool for moving verified worktree commits onto local main.
node .claude/skills/fleet/managing-worktrees/lib/land.mts --last 2 --push --local
```

The cherry-pick runs per commit with an outcome table: a content-equivalent commit (already landed via a squash-merge or auto-land - the headline scenario) is DROPPED as `skipped-already-landed`, and only a real conflict aborts. To see per-commit landed/unlanded/superseded verdicts for every worktree before landing anything, run the read-only audit: `node .claude/skills/fleet/tidying-worktrees/lib/tidy-worktrees.mts --audit`.

The lint re-assert is the contract: a clean diff lands instantly; a lint failure ABORTS; the lint-as-edit contract was bypassed → `pnpm run fix` + re-commit. Only pass `‑‑no‑verify‑lint` when the checkout genuinely can't run oxlint (no `node_modules`) AND you know the diff was lint-clean at edit time. The throwaway worktree + branch are cleaned up automatically; the `git push ‑‑no‑verify` is deliberate - the diff is lint-verified above, and a fresh worktree's hooks can't load the lib.
