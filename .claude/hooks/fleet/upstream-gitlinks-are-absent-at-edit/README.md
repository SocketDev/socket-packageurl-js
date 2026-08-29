# upstream-gitlinks-are-absent-at-edit

**Type:** PreToolUse hook (GUARD - blocks).

## What it does

BLOCKS any Bash git command that would STAGE a path under `upstream/` into the
index - `git add upstream/…` (incl. `-f`), `git submodule add … upstream/…`,
and `git update-index --add … upstream/…`. Upstream reference submodules are
`.gitmodules`-only: the `ref = <40hex>` field is the pinned commit of record,
so a tracked gitlink (a `160000` index entry) would be a redundant second copy
of that same SHA. `upstream/` is always git-ignored and is never re-included
with a `!` negation.

`git update-index --force-remove upstream/…`, dropping a stray gitlink, and
`git add .gitmodules`, the record itself, are the FIX, not the violation - the
guard leaves both alone.

Detection is shell-command tokenized, not a raw regex: the git subcommand is
the first bare token; a path argument is "under upstream/" after normalizing
separators + stripping a leading `./`. Fails open on parse errors - a guard
bug must not block every Bash call.

Convention: docs/agents.md/fleet/upstream-references.md.
Bypass: `Allow upstream-gitlink bypass`.

## Bypass

Bypass slug: `upstream-gitlink`. The grant phrase is typed by the operator; an agent relaying it never counts as a grant.
