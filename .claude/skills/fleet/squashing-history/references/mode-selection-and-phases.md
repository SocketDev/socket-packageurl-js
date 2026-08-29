# Mode selection and the 8 phases

The runner first resolves the **freeze boundary**: the newest published-release commit (npm
`gitHead` / crates.io `.cargo_vcs_info.json`, ancestor-verified against the tip being squashed). A
repo that has never published (still `0.0.0` on every registry) has no boundary and squashes full-root
as below. A repo with a resolved boundary **always** runs **tail mode**, regardless of the
local-vs-origin relationship - every commit through the boundary stays byte-identical, and only
`boundary..tip` collapses to one fresh commit. See
[`squash-until-release`](../../../../../docs/agents.md/fleet/squash-until-release.md).

With no boundary, the runner picks a mode from the local-vs-origin relationship (local main is
canonical in the fleet):

- **Local-canonical mode** (local `$BASE` is AHEAD of origin): backup-push the LOCAL tip, mint a
  signed root from its tree via `git commit-tree` (`mintSquashRoot()` - pure object creation, no
  worktree, the primary checkout's index/worktree are never touched), verify the tree is
  byte-identical, point the local branch at the root, lease-push against origin's tip.
- **Origin mode** (local == origin, or no local branch): the classic worktree flow below.
- **Diverged** (origin holds commits local lacks): REFUSED loudly - reconcile forward (merge origin
  into local) first, then re-run.

| #   | Phase           | What it does (origin mode)                                                                        |
| --- | --------------- | ------------------------------------------------------------------------------------------------ |
| 1   | Pre-flight      | Resolve default branch (main → master fallback); fetch; capture orig HEAD + count.               |
| 2   | Worktree        | Add `chore/squash` worktree at `<repo>-squash` tracking `origin/$BASE`.                           |
| 3   | Backup          | Push `$ORIG_HEAD` to `refs/heads/backup-YYYYMMDD-HHMMSS` before any destructive op.               |
| 4   | Squash          | Soft-reset to the root commit, then amend it; verify commit count == 1.                           |
| 5   | Integrity       | Diff against `$ORIG_HEAD` (ignoring submodules) must be empty (HARD exit otherwise).              |
| 6   | Push            | Lease-push the single commit to `$BASE` under the sentinel.                                       |
| 7   | Cleanup         | Remove worktree + delete the temp branch.                                                         |
| 8   | Report          | Print new SHA + backup ref name + recovery one-liner.                                             |

**Tail mode** runs whenever a boundary is resolved. It uses the same
worktree/backup/integrity/lease-push shape, with two differences: the reset target is the frozen
boundary rather than the root, so `resetTo: boundary, amend: false` writes a FRESH commit and never
rewrites the release commit, and a runtime `assertBoundaryIntact()`
check after the squash re-verifies the boundary still resolves to itself and is still an ancestor of
the new tip before the push. `[Unreleased]` accrues only `boundary..tip`, never the whole root - the
released commits below the boundary already carry their own version heading in CHANGELOG.md.
