# prefer-inline-small-dependency-nudge

PreToolUse `Edit`/`MultiEdit`/`Write` hook that nudges (never blocks) when an
edit adds a NEW `package.json` dependency - a name absent from `old_string`
that appears in `new_string`, not a version bump of an existing one.

Reaching for npm for a small, single-purpose, permissively-licensed utility
adds a `node_modules` entry, a lockfile bump, and a transitive-dep surface
for logic that could be ported in-tree instead. See
[`docs/agents.md/fleet/prefer-inlining-small-deps.md`](../../../../docs/agents.md/fleet/prefer-inlining-small-deps.md).

## What it flags

An `Edit`/`MultiEdit`/`Write` whose target basename is `package.json` AND
whose `new_string`/`content` contains a dependency-entry line
(`"name": "spec"`, spec looking like a real version/range/protocol) for a
package name not present in `old_string`.

## What it does NOT flag

- A version bump of an existing dependency (the name is already present in
  `old_string`).
- A `Write` with no `old_string` to diff against - no baseline means no
  reliable "is this new" signal.
- Edits to any file other than `package.json`.

## Trigger

Fires on `Edit` / `MultiEdit` / `Write` PreToolUse events. Always exits 0;
the reminder is informational on stderr.

## Bypass

No bypass phrase - this hook never blocks.

## Companion files

- `index.mts` - the hook; `newlyAddedDependencyNames(oldText, newText)` is
  the pure exported detector.
- `test/repo/integration/hooks/prefer-inline-small-dependency-nudge.test.mts` -
  vitest integration tests (spawn-based, never self-import).
