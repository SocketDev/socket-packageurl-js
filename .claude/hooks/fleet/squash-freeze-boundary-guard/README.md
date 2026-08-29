# squash-freeze-boundary-guard

**Type:** PreToolUse hook (GUARD - blocks).

## What it does

Blocks a MANUAL full-root history flatten in a repo that has a frozen
release boundary - the same hazard `squashing-history`'s runtime
freeze-boundary resolution (`resolveFreezeBoundaryForRepo`) exists to
prevent, caught here BEFORE a hand-rolled command ever reaches git. Three
shapes, all of them mint (or land on) a NEW root with no ancestor:

1. `git reset --soft <ref>` where `<ref>` resolves to the repo's ROOT
commit - the first half of a hand-rolled full-root squash.
2. `git rebase --root` (any form) - rebases the whole branch onto a new
root, discarding every parent link below it.
3. `git commit-tree <tree>` with NO `-p <parent>` - mints a PARENTLESS
commit, the exact shape `mintSquashRoot()` uses, run by hand instead
of through the runner.

Gated on a CHEAP, LOCAL, no-network signal: the repo is opted into
`squash-history` AND its root manifest (package.json / Cargo.toml) reports
a REAL (non-`0.0.0`) version. This is a best-effort heuristic, not the
authoritative check - `resolveFreezeBoundaryForRepo` (registry reads +
ancestor-verification) is what the sanctioned runner uses, and it stays
the actual safety mechanism regardless of this guard's precision. A false
positive here just means running the sanctioned script instead of the raw
command; a false negative leaves the runner's own runtime check as the
backstop.

Fails open on parse / payload errors, outside a fleet repo, on a repo
still at the placeholder version, and on a repo not opted into
`squash-history` at all - this guard's whole job is the frozen-zone case.

## Bypass

Bypass slug: `squash-freeze-boundary`. The grant phrase is typed by the operator; an agent relaying it never counts as a grant.
