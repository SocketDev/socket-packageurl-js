# config-refs-are-segregated-at-edit

**Type:** PreToolUse hook (GUARD - blocks).

## What it does

BLOCKS source that constructs a LOOSE `.config/<file>.{json,yaml,yml,toml}`
path - either a string literal (`'.config/lockstep.json'`) or a path.join
pair (`path.join(x, '.config', 'lockstep.json')`). `.config/` is segregated:
the segment after `.config` MUST be `repo` (repo-owned) or `fleet`
(fleet-identical). A loose reference is legacy back-compat for a config we've
already relocated 100% - there is no transient to fall back for, so point at
the one canonical home instead of adding a fallback branch.

Config DATA only (.json/.yaml/.yml/.toml); code configs are exempt. Bypass:
`Allow loose-config-ref bypass` for a genuinely external/loose config. Fails
open on hook bugs (exit 0 + stderr log).

Rule: docs/agents.md/fleet/config-segregation.md.

## Bypass

Bypass slug: `loose-config-ref`. The grant phrase is typed by the operator; an agent relaying it never counts as a grant.
