# private-package-name-guard

**Type:** PreToolUse hook (GUARD - blocks).

## What it does

Blocks a `package.json` write that gives a `private: true` package a
publishable-looking identity. `private-packages-are-unpublishable` already
catches this, but at the GATE - by which point the name is in the manifest,
possibly in a lockfile, and possibly referenced by a sibling. Renaming then
costs a reference sweep. Renaming at the edit costs one keystroke.

Three ways a private package reads as publishable, all blocked here:
- a SCOPE (`@acme/tests`), which squats a namespace the repo may not own
- a name that is not `local-<own directory>`
- a version other than `0.0.0`, which invites release reasoning about
something that never ships

The name is the package's OWN directory, never its path. A path-derived name
renames on every move, so relocating a directory would rewrite every
dependent manifest and the lockfile for a change that moved no code.

`local-` rather than `private-`: on npm a "private package" is a PUBLISHED
one with restricted access, so that prefix would mean the opposite of what
it says here.

Two identities are left alone: the repo ROOT manifest, which carries the
repo's own name, and a manifest a repo declares as its
`release.versionSource`, whose version is a real release number on a channel
npm never sees.

Bypass: `Allow private-package-name bypass`.

## Bypass

Bypass slug: `private-package-name`. The grant phrase is typed by the operator; an agent relaying it never counts as a grant.
