# hook-snapshot-rewire-nudge

**Type:** PreToolUse hook (NUDGE - informational, never blocks).

## What it does

NON-BLOCKING. Fires when a hand edit wires the per-machine V8-snapshot
launcher (`dispatch-launcher`) into `.claude/settings.json`'s hook-dispatch
commands - the wrong turn this nudge exists to catch.

The dispatch wiring is PER-MACHINE snapshot state owned by
`node scripts/fleet/setup/hook-snapshot.mts` (idempotent). Every fleet cascade
rewrites `settings.json` to `merge(template, repo-hooks)`, which reverts the
dispatch commands to the portable baseline (`index.cjs`) - SAFE and
correct on CI / a fresh checkout / a member, where the launcher was never set
up.

Crucially, the `hook-snapshot-is-wired` check ("hook-snapshot-is-active")
only fires on a machine that OPTED IN, the native launcher exists, AND is
RELEASE-tier: it gates `github-release.yml`, NOT `⚡ CI` (which runs the
interactive `pnpm run check --all`). So a reverted wiring never reds ⚡ CI, and
hand-editing `settings.json` to chase that check is wasted effort. Re-wire with
the setup script, or ignore it for a ⚡-CI-green fix.

Detects an Edit/Write whose `file_path` is `.claude/settings.json` and whose
incoming content introduces `dispatch-launcher`, and a Bash write (`sed -i`,
`tee`, `>`/`>>` redirect) of `dispatch-launcher` into `settings.json`. Reads
are ignored; fails open on parse errors - a nudge must never block a call.

Convention: docs/agents.md/fleet/hook-registry.md.

## Bypass

None - it only prints informational text and cannot block or mutate anything.
