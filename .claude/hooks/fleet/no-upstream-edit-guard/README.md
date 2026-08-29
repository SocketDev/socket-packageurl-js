# no-upstream-edit-guard

**Type:** PreToolUse hook (GUARD - blocks).

## What it does

BLOCKS any write to a path under `upstream/`. Upstream reference submodules are
PRISTINE: the exact, pinned upstream bytes, kept read-only and referenced ONLY
for lock-step porting into the fleet's own controlled copies (e.g.
`.github/actions/fleet/*`) - we port what we need, nothing else, and never
touch or directly link the reference. This guard is the enforcement:
- Edit / MultiEdit / Write with a `file_path` under `upstream/`.
- Bash writes whose TARGET is under `upstream/`: `sed -i … upstream/…`,
`tee upstream/…`, `rm … upstream/…`, `… > upstream/…` / `… >> upstream/…`,
and `cp`/`mv`/`ln` whose final destination arg is under `upstream/`.
Reading FROM `upstream/`, the porting source, is always allowed. Refreshing a
pin is `vendor-actions.mts` / `gen/gitmodules-hash.mts --set`, not a hand-edit.

Detection normalizes separators before the prefix test and fails open on parse
errors - a guard bug must not block Bash/edit calls.

Convention: docs/agents.md/fleet/upstream-references.md.
Bypass: `Allow upstream-edit bypass`.

## Bypass

Bypass slug: `upstream-edit`. The grant phrase is typed by the operator; an agent relaying it never counts as a grant.
