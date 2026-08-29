# codify-footgun-nudge

**Type:** PostToolUse + Stop hook (NUDGE - informational, never blocks).
Global: it fires in any cwd, because a repeated mistake is worth codifying
wherever it happened and the artifacts it points at live in the fleet repo.

## Trigger

Fires when the last assistant turn ADMITS repeating a known mistake and names
nothing that prevents the next one. The admission shapes it reads:

- "I hit that footgun again"
- "same mistake as earlier"
- "my own notes warned about this"
- "I should have known to …"

## What it says

That the loop closed on nothing. A note already existed and was not consulted
in time, so writing another note is the one response guaranteed not to help.
It points at the `codifying-footguns` skill, because the pass that hits a
footgun is the pass that can still afford to codify it.

## What keeps it silent

Silence is keyed on EVIDENCE, never on wording. A reply that names something
executable beside the admission has produced the artifact, so there is nothing
to nudge:

- a hook path (`.claude/hooks/fleet/<name>/`)
- a `socket/*` lint rule
- a fleet script
- the `codifying-footguns` skill

An admission naming none of those has not closed the loop.

## Why a nudge and not a guard

The admission is often exactly the right prose: a post-mortem, a report
explaining a new rule, this hook's own doc. Blocking those would make the
honest report the expensive one to write.

## Division of labor

- **This hook** reads the admission in the reply - the moment a footgun is
  known to have repeated.
- **`uncodified-lesson-nudge`** (Stop) reads a written lesson that cites no
  enforcer.
- **`memory-codify-nudge`** (PostToolUse) fires on the memory write itself.

Detail:
[`memory-codification`](../../../../docs/agents.md/fleet/memory-codification.md)

## Bypass

`Allow footgun-note bypass`
