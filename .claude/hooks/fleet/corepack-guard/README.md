# corepack-guard

**Type:** PreToolUse hook (GUARD - blocks). Global: it fires in any cwd.

## What it does

that invokes `corepack`, in any subcommand form: `corepack prepare`,
`corepack enable`, `corepack pnpm`, and so on. Why: pnpm changes its own
version without corepack. `pnpm with <version> <args>` runs one invocation
at a specific version cached in the global virtual store, and
`pnpm self-update` bumps the shim itself. The wheelhouse ships its own
pnpm shim and pins the version in the manifest, so corepack bypasses both
the pin and the shim, and the fleet does not install latest that way.
Detection tokenizes at command position via the shared `parseCommands`
parser, so a quoted argument such as a `git commit -m 'mentions corepack
in prose'` stays ONE token and never false-matches the name; only an
actual invocation, bare or through `find -exec` / `xargs`, tokenizes the
name as its own word. Bypass: `Allow corepack bypass` typed verbatim in a
recent user turn, for the rare real one-off. Fails open on parse/payload
errors, since a guard bug must not block every Bash call.

## Bypass

Bypass slug: `corepack`. The grant phrase is typed by the operator; an agent relaying it never counts as a grant.
