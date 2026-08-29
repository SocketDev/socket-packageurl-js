# foreign-repo-conventions-nudge

**Type:** PreToolUse hook (NUDGE - informational, never blocks).

## What it does

Fires when an Edit/Write lands in a DIFFERENT repo than the one the session
started in, and that repo carries its own instruction file. Names the file so
the target repo's rules govern the edit instead of the originating repo's.

The failure this prevents, seen 2026-08-20: a session rooted in a non-fleet
repo edited a fleet member for hours while applying the ORIGIN repo's
AGENTS.md. It refused `vi.mock` in a repo where mocks are the convention and
`socket/prefer-mock-import` lints for their exact form, and reported a policy
violation that did not exist. Nothing was wrong with the hooks: `scope:
'convention'` already resolves the ACTED-ON repo. What is loaded into the
agent's context is the SESSION repo's instruction file, and nothing said the
two had diverged.

A nudge, not a guard: the edit is legitimate, only the rulebook in context is
wrong. Blocking would stop cross-repo work that is routine here (a wheelhouse
session cascading into a member, a fleet fix landed downstream).

No `scope: 'convention'`: the rule decides WHICH conventions apply, so gating
it on the target being fleet-managed would silence it in exactly the direction
that misfired. No `mode` either, since this is not governance.

Once per (session, target repo), so a session touching several repos hears
about each and a long session is not nagged per edit.

Fails open on any IO error: a hook bug must never stop an edit.

## Bypass

None - it only prints informational text and cannot block or mutate anything.
