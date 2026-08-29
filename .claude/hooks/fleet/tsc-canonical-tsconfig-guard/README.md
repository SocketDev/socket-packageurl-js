# tsc-canonical-tsconfig-guard

**Type:** PreToolUse hook (GUARD - blocks).

## What it does

Makes the agent type-check through the CANONICAL check config instead of a
hand-picked tsconfig. Fleet repos carry more than one tsconfig: the
repo-root tsconfig.json is a base/editor config, while the check surface -
the one `pnpm run check` runs - is `.config/fleet/tsconfig.check.json`,
which enables allowImportingTsExtensions for the `.mts`-extension imports
every hook and fleet script uses. A raw `tsc --noEmit -p tsconfig.json`
or a bare `tsc --noEmit` therefore produces a wall of TS5097
"import path can only end with .mts" noise that reads as real breakage
and sends the session chasing phantom errors - the exact time sink this
guard exists to close.

BLOCKED: a Bash segment that runs tsc with `--noEmit` where the
`-p`/`--project` value is missing or points outside `.config/` -
- `tsc --noEmit`, `tsc --noEmit -p tsconfig.json`
- `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`
- `pnpm exec tsc --noEmit`

ALLOWED, never blocked:
- `tsc --noEmit -p .config/fleet/tsconfig.check.json` - the canonical
check surface, any `.config/`-rooted project file.
- `pnpm run check` and the check scripts - they match no rule here.
- tsc WITHOUT `--noEmit` - a build invocation is a different surface.

The decision is a PURE function, decideTscTsconfigGuard, over the parsed
command, so it is exhaustively unit-tested without touching the filesystem.
Segments are AST-parsed via commandsFor - robust to env assignments,
quoting, and `&&` / `;` / `|` chains - so a quoted "tsc --noEmit" inside a
commit message never false-fires.

Does NOT fire when:
- the context is CI - CI runs the gates through its own workflow.
- the acted-on repo is not fleet-managed - scope 'convention' stands the
hook down in a foreign repo.

Bypass: `Allow tsc-raw-tsconfig bypass` typed verbatim in a recent user
turn - for the genuine case of type-checking a non-fleet project file.

Fails open on parse / payload errors - a guard bug must not block every
Bash call.

## Bypass

Bypass slug: `tsc-raw-tsconfig`. The grant phrase is typed by the operator; an agent relaying it never counts as a grant.
