# no-pr-assets-in-branch-guard

**Type:** PreToolUse hook (GUARD - blocks). Global: it fires in any cwd.

## What it does

Blocks a `git add` / `git commit` that would put files under a `pr-assets/`
path segment into the PR's own branch.

Screenshots and recordings made to illustrate a pull request are not the
change under review. Committing them to the review branch bloats the diff,
puts binaries in that branch's history for good, and reads to a reviewer as
part of the proposal - on 2026-08-10 a reviewer asked, of a committed
`docs/pr-assets/` directory, "Why are we adding these? and where?", which is
the correct question. The images belonged in the PR body; the branch should
have carried only code.

The fix is a mirror branch, not deletion: keep the assets, put them on
`<branch>-assets`, push that, and reference them from the PR body. The review
branch then stays reviewable and the assets stay recoverable.

Only NEW or MODIFIED asset paths trip this, read from `git status`, so a repo
that legitimately tracks such a directory already is unaffected - the guard is
about what this change adds, not about what history holds.

Fires everywhere via `global: true`: the incident was in a product repo, not
in the fleet.

Bypass: `Allow pr-assets-in-branch bypass` in a recent user turn.

Fails OPEN when the repo, the branch, or `git status` cannot be read: a guard
that blocks a commit because git was unavailable is worse than a missed case.

## Bypass

Bypass slug: `pr-assets-in-branch`. The grant phrase is typed by the operator; an agent relaying it never counts as a grant.
