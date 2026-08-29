# bash-timeout-nudge

**Type:** PreToolUse hook (NUDGE - informational, never blocks).

## What it does

THE FAILURE THIS CATCHES: a command is run under a timeout smaller than the
work actually needs. The tool kills it, the kill reads like a failure, and
the caller starts diagnosing a suite, build, or install that was never
broken - burning tool calls on a phantom. It happened in this repo with
`pnpm test`, killed at 120s on a suite that needs several minutes.

The timeout has to be chosen BEFORE the command runs, and nothing in the
repo said how long each slow command takes, so the number was always a
guess. `_shared/duration-budgets.mts` is the measured answer; this hook is
what puts it in front of the caller at the only moment it can still help.

Fires only when a measured budget EXCEEDS the requested timeout, so the
common case stays silent. Never blocks: a wrong guess about duration must
not stop a command from running.

## Bypass

None - it only prints informational text and cannot block or mutate anything.
