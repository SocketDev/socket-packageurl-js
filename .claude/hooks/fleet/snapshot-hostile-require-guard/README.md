# snapshot-hostile-require-guard

PreToolUse Edit/Write/MultiEdit hook that blocks a module-scope load of a
snapshot-hostile builtin in a file the V8 startup snapshot bundles.

## Why

The fleet boots its hook dispatcher from a V8 startup snapshot, which is built
by evaluating every bundled module once and serializing the resulting heap. A
builtin backed by a native binding registers an external reference V8 cannot
serialize, so loading one while a module evaluates aborts the build:

```text
Unknown external reference 0x104fdaf60.
<unresolved>
```

Exit 133, and the message names neither the module nor the hook that pulled it
in - against a 2.9 MB pack. Finding it by hand costs a bisect of the whole hook
set. It has already cost one: `node:sqlite` reached the pack from
`scripts/fleet/_shared/socket-state.mts`, and the abort said nothing about
either name.

A load inside a function body is fine. The function runs after
deserialization, so the binding is registered in the live process rather than
during the build - which is why `process.getBuiltinModule()` inside the
function that needs it is the standing fix.

## What it blocks

| Written at module scope                              | Verdict |
| ---------------------------------------------------- | ------- |
| `import { DatabaseSync } from 'node:sqlite'`          | blocked |
| `const { DatabaseSync } = require('node:sqlite')`     | blocked |
| `process.getBuiltinModule('node:sqlite')`             | blocked |
| the same three inside a function body                 | passes  |
| any of them in a `@dispatch-snapshot-exclude` hook     | passes  |
| a file outside the snapshot graph                      | passes  |

Scope is `.claude/hooks/fleet/**` plus `scripts/fleet/_shared/**`. A `_shared`
module counts because a hostile load there reaches every hook importing it.

## How

`findModuleScopeHostileLoads` parses the written content and walks only the
statements that run at module eval, stopping at every function boundary. The
list of hostile builtins (`SNAPSHOT_HOSTILE_BUILTINS`, today `node:sqlite`) is
measured rather than guessed: each entry was confirmed to abort
`--build-snapshot`.

Content that does not parse passes, so an in-progress editor buffer is never a
violation.

## Shared with

One list and one detector, three surfaces:

- this guard, at write time;
- `socket/no-snapshot-hostile-builtin`, at lint time;
- `scripts/fleet/_shared/snapshot-hostile-builtins.mts`, which names the
  offender in a build that already aborted.
