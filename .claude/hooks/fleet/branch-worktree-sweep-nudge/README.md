# branch-worktree-sweep-nudge

Stop hook, non-blocking. At turn-end, scans for stale worktrees and
redundant/superseded local branches that can be cleaned up.

## Why

Agent-driven work leaves stale worktrees and merged/superseded branches
that pile up. Separately, squashing a stacked change can silently DROP
work - a squashed branch can lose files or CI steps that the original
branch carried. This guard makes cleanup a **decision** rather than a
default, and bakes in the verify-before-delete rule so a branch is never
flagged "safe to delete" without proof that its content is actually
contained in the kept branch.

## Behavior

At turn-end, against the current repo:

1. **Stale worktrees** - `git worktree list` entries whose branch is
   merged into the default branch, whose worktree directory is gone, or
   whose detached HEAD is older than 7 days. Nudges to
   `git worktree remove` + `git worktree prune`. Never touches the
   primary checkout or a worktree with uncommitted/staged changes.

2. **Redundant branches** - local branches fully contained in the
   default branch. Two verification methods:
   - **Ancestry** (`git merge-base --is-ancestor`): the branch's commits
     are a subset of the default branch's history. Fast and definitive.
   - **Content containment**: for squash-merged branches where ancestry
     fails, the guard diffs each file the branch changed against the
     default branch. If every file's content matches, the branch's work
     is present despite different commit hashes.

3. **Unverified branches** - branches that look redundant (ancestry
   fails) but whose content containment can't be proven. The nudge says
   "verify content containment before deleting" rather than "safe to
   delete." This is the squash-drop guard: a branch whose `scripts/tsconfig.json`
   was lost in the squash will show an uncontained file diff and will NOT
   be flagged safe to delete.

## The verify-before-delete rule

The headline rule. Before flagging a branch for deletion on the basis
that it's "redundant" or "superseded," the guard requires
content-containment proof - not just commit ancestry. Upstream
squash-merges rewrite commits, so `git merge-base --is-ancestor` returns
false for genuinely-merged work. The correct check is: the branch's
tree/content diff against the kept branch is empty for the files that
matter. If containment can't be proven, the nudge says "verify content
containment before deleting."

## Output

Silent on the happy path. When stale worktrees or redundant branches are
found, writes to stderr:

```
branch-worktree-sweep-nudge: 1 stale worktree(s):
  branch 'feat/done' is merged into main - `git worktree remove /path/to/wt`
branch-worktree-sweep-nudge: 2 redundant branch(es) safe to delete:
  branch 'feat/merged' is an ancestor of main - safe to delete
  branch 'feat/squashed' content is contained in main (content-verified) - safe to delete
branch-worktree-sweep-nudge: 1 branch(es) need verification before deleting:
  branch 'feat/maybe' looks redundant but content containment unproven - VERIFY before deleting
```

## Bypass

None needed. A reminder never blocks; hook output is informational.
