# use-repo-test-script-guard

**Type:** PreToolUse hook (GUARD - blocks). Global: it fires in any cwd.

## What it does

Blocks invoking a test runner DIRECTLY (`npx vitest`, `node --test`,
`npx jest`, …) when the repo's own package.json already defines a
script that runs it.

Why this exists: a repo's runner is not inferable from the file
extension, the directory name, or from a sibling repo. Guessing it
produces output that reads as a defect in the CODE rather than an
error in the invocation, which is how it wastes the most time. Real
incident: `npx vitest run src/**` in a non-fleet repo reported "No
test suite found in file" - that repo runs `src/**` under node:test
via `npm run test:unit` and uses vitest only for `test/**`. The file
was fine; the command was wrong. A fleet convention had been carried
into a repo that is not a fleet member.

The repo's own scripts are the law. They encode the runner, the
flags, the config path, the setup files, and the env - none of which
a hand-written invocation reproduces by accident.

DENIES (only when a matching script exists):
- vitest run …                → <pm> run test:unit
- node --test 'src/**/*.mts'  → <pm> run test:unit
- pnpm exec jest              → <pm> run test
A TEST-SHAPED script that DELEGATES (`test: "node scripts/fleet/test.mts"`)
counts as a match when the wrapper file wraps a runner - the fleet test
runner hides vitest behind exactly that shape, one hop past the
package.json text. Non-test-shaped delegators never match: a build script
whose file happens to mention a runner word is not the repo's test law.

DENIES ALWAYS (in a pnpm-pinned repo): any runner launched via npx - npx
runs npm, which devEngines rejects, and fetches an unpinned runner copy.
Suggestions follow the repo's own package manager (pnpm vs npm).

ALLOWS:
- the package script itself (npm/pnpm run <script>)
- a direct run when NO script matches that runner - there is nothing
better to point at, and blocking would leave no way to run tests
- any non-test command

CROSS-REPO: a leading `cd <repo> &&` retargets the package.json lookup to
the driven repo, and `global: true` wires the guard through the user-global
dispatcher so it fires from EVERY repo session, not just wheelhouse-hosted
ones - the wrong-runner mistake is easiest to make exactly there, where
neither the session's hooks nor muscle memory covers the target repo.

Bypass: `Allow direct test runner`, typed by the human in a genuine
user turn.

## Bypass

Bypass slug: `direct-test-runner`. The grant phrase is typed by the operator; an agent relaying it never counts as a grant.
