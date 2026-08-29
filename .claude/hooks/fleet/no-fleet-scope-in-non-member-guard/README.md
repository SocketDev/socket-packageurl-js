# no-fleet-scope-in-non-member-guard

**Type:** PreToolUse hook (GUARD - blocks). Global: it fires in any cwd.

## What it does

Blocks `git commit` when the subject carries the conventional scope
`fleet` - `chore(fleet): …`, `fix(fleet)!: …` - and the target repo's
origin remote is NOT in the fleet roster. The incident this codifies:
a fleet sweep treated a non-member clone under ~/projects as fleet
surface and landed a fleet-convention commit there. A fleet-scoped
subject asserts "this is fleet work", so a non-member origin means
the tooling is aimed at the wrong repo - the commit-message shape is
the clean, deterministic signal (the commit-message-format-guard
precedent).

Scoped, not absolute: only the exact scope `fleet` fires; any other
scope, an unscoped subject, or a non-conventional subject is out of
scope. Fails OPEN when the origin remote is unresolvable - an
unclassifiable repo must not block unrelated commits.

Detection model mirrors no-non-fleet-push-guard: resolve the TARGET
directory (`git -C <dir>`, a leading `cd <dir> && …`, else the hook's
cwd), read its origin remote, and block when the slug is outside the
roster (.claude/skills/fleet/cascading-fleet/lib/fleet-repos.json).

Bypass: `Allow fleet-scope-commit bypass` - the scoped form
`Allow fleet-scope-commit bypass: <repo>` is preferred; it authorizes
exactly one repo.

## Bypass

Bypass slug: `fleet-scope-commit`. The grant phrase is typed by the operator; an agent relaying it never counts as a grant.
