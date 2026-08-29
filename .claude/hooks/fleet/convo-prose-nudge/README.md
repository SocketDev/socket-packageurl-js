# convo-prose-nudge

**Type:** PreToolUse hook (NUDGE - informational, never blocks).

## What it does

Fires when Claude is about to run a `gh pr create|edit|comment` or
`gh issue create|edit|comment` command whose body - given inline via
`--body`/`-b`, or as a file via `--body-file`/`-F` - contains
AI-scaffolding antipatterns: throat-clearing openers ("I've gone ahead
and…", "Let me…", "In this PR, I…", "I took a look and…"), closing filler
("Let me know if you have any questions!", "Hope this helps!"), and honesty
framing (the shared _shared/honesty-framing.mts matcher: "to be honest",
"honestly", "Frankly,", …).

REMINDER (exit 0 + stderr), never a block. The prose skill
(.claude/skills/fleet/prose/SKILL.md, references/conversational.md) is the
correction path - rewrite the body through it before re-running the command.

Triggers on Bash commands that contain 'gh pr' or 'gh issue' (fast pre-
dispatch filter). Uses the fleet AST parser (commandsFor) to detect `gh`
invocations - no regex command matching. A parse failure exits 0 silently
(fail-open - a nudge must never block on its own bug).

## Bypass

None - it only prints informational text and cannot block or mutate anything.
