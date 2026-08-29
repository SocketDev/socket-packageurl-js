# verify-absence-claims-nudge

**Type:** Stop hook (NUDGE - informational, never blocks).

## What it does

Fires at turn-end. Scans the last assistant turn for an ABSENCE or PROVENANCE
claim stated as fact - "there are no X", "X doesn't exist here", "X is
vendored from Y", "that would land in <other repo>" - and reminds the agent
to VALIDATE it before asserting: re-run the search WITHOUT path exclusions
the dir you excluded may be the one holding it, and check `git ls-files`.

Why: a confident negative ("no wasm generators here; acorn is vendored from
socket-lib") stated off a too-narrow grep - one that excluded the very tree
holding the file - misleads the user and derails the task. An absence claim is
only as good as the search behind it, and provenance is a read, not a guess;
this nudge makes verification the precondition for the assertion.

Verdict: notify (informational; never blocks - a Stop hook has no tool call to
refuse). Code-fenced / inline-code text is ignored. Fail-open on any error.

Rule: docs/agents.md/fleet/judgment-and-self-evaluation.md.

## Bypass

None - it only prints informational text and cannot block or mutate anything.
