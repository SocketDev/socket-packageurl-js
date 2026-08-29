# Mode 3: `prune`

Remove a worktree when its **working tree is clean** AND it has **nothing left to land**. "Nothing to land" means the branch is **fully merged into the remote's default branch** (every commit is already an ancestor of `origin/<base>`), OR the branch is **100% landed** (each ahead commit is content-equivalent to the base: its work arrived via a squash-merge, auto-land, or rebase, proven per commit with in-memory `git merge-tree`, so a history squash can't hide it), OR the **branch no longer exists on the remote AND the worktree is not ahead of the base**. A worktree **ahead of the base with content the base lacks** is kept, because a local-only branch never pushed (e.g. an isolation worktree) reads as "branch gone from remote" yet carries unpushed work that pruning would destroy. That holds even when its branch is gone from the remote.

This is the same removability predicate (`decideWorktree`) the fleet-wide `tidying-worktrees` sweep applies - Mode 3 is the single-repo entry to that one engine, so it inherits the load-bearing `aheadOfBase` guard rather than re-deriving a weaker check in shell.

```bash
# Dry-run (default): report what WOULD be pruned in the CURRENT checkout.
node .claude/skills/fleet/tidying-worktrees/lib/tidy-worktrees.mts --here

# Act: prune the spent worktrees of the current checkout.
node .claude/skills/fleet/tidying-worktrees/lib/tidy-worktrees.mts --here --fix
```

`--here` resolves the current checkout's git toplevel (not a `$PROJECTS` sibling) and runs the engine against only that repo. The engine never discards work: a dirty tree is kept, a worktree ahead of the base is kept, and removal uses the clean-tree-gated `--force` only to clear the submodule-worktree guard. After pruning, `pnpm i` in the primary checkout - a `git worktree remove` can dangle the main checkout's `node_modules` symlinks (per the _Don't leave the worktree dirty_ rule); the engine prints that reminder.
