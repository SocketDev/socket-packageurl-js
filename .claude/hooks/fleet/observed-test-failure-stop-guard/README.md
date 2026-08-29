# observed-test-failure-stop-guard

**Type:** Stop hook (GUARD - blocks).

## What it does

Fires at turn-end. Blocks the stop while a test scope this checkout ran is
still recorded red in `.cache/fleet/socket-failing-tests/`.

The hole it closes, observed live: the pre-commit test gate runs the STAGED
scope. A session that runs a broader suite, watches a test fail in a file it
did not stage, then commits its own files sails straight through - the gate
never re-runs the failure, so nothing objects and the red is left for the
next session to find. The fleet rule ("fix a lint/type/test error in your
reading window in a sibling commit") had no code behind it at exactly the
moment it mattered.

A scope leaves the ledger only when the SAME scope runs green, so re-running
it is the one way out. There is deliberately no acknowledge-and-move-on path:
that is the behavior this exists to stop.

Pre-existing versus mine is NOT a question the guard asks. A red test in the
reading window is the turn's problem whoever wrote it - sorting ownership is
how the failure gets deferred instead of fixed.

## Bypass

Bypass slug: `failing-test`. The grant phrase is typed by the operator; an agent relaying it never counts as a grant.
