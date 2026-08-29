# artifact-gates-on-stop

**Type:** Stop hook (GUARD - blocks).

## What it does

At turn-end, looks at every artifact left dirty in the working tree - a hook,
lint rule, skill, agent or rule - and runs the gates that own that kind. While
any of them fail, the stop is refused.

Which gates own which kind comes from
`.claude/hooks/fleet/_shared/artifact-gates.mts`. This hook adds no rules of its
own; it only runs the ones already in `scripts/fleet/check/` at a moment where
they can still change the outcome.

## Why it exists

`codifying-footguns` landed with an over-long description, no catalog entry, and
a citation to a `pnpm run` script that members did not have. Every one of those
was already gated. None of the gates ran until `check --all`, so the artifact
landed broken and the next session inherited it.

The rule and the gate were both present. The missing piece was a surface that
ran the gate before the artifact was banked.

## Why turn-end, and why blocking

A hook is four files. A PreToolUse block would refuse the first three writes of
every hook anyone ever adds, so the check belongs where the artifact is whole.

It blocks rather than nudges because these gates already said no once. Reporting
them as advice reproduces the same landing one turn later.

## Cost

Scope is `git status --porcelain`, so a clean tree runs nothing and the common
turn pays one `git status`. Gates run only for the kinds actually touched.

## Bypass

Fix the artifact. If a gate is wrong, that is a change to the gate, not a reason
to land around it.
