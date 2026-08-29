# model-fallback

**Type:** SessionStart hook (NUDGE - informational, never blocks). Global: it fires in any cwd.

## What it does

availability fallback.

The tier env vars in ~/.claude/settings.json (ANTHROPIC_DEFAULT_*_MODEL,
CLAUDE_CODE_SUBAGENT_MODEL) point each Claude Code model tier at one model
on one provider. An alias that stops serving fails its whole tier CLOSED -
a down classifier tier blocks every classified action in every session
(measured: glm-fast-latest flapping took every Edit/Write/Bash-mutation
down for hours). This hook is the poller: at session start it probes the
tier's rung and, when it does not serve, walks a RANKED LADDER that
criss-crosses providers to the next best model that does:

fireworks (direct, Anthropic-compatible)
→ synthetic (through the ai-balancer, OpenAI-shaped upstream)
→ odai (on-device llama-server through the ai-balancer, keyless)
→ anthropic (native subscription auth: the overrides come OFF, the floor)

A rung is SKIPPED when it is not set up on this machine - no credential, no
odai binary, no llama-server - so a bare machine slides straight to the
Anthropic floor, which is the one provider a Claude Code session always
has. When the ideal serves again, the next session's probe walks back up
the ladder and restores it: the fallback is never a hand-edit someone has
to remember to revert.

WHAT IT TOUCHES. Only the model-tier env keys plus ANTHROPIC_BASE_URL,
ANTHROPIC_CUSTOM_HEADERS, and AI_BALANCER_PRIMARY_PROVIDER in
~/.claude/settings.json, rewritten atomically (scratch + rename) only when
a value actually changes; the starting session gets the same values through
CLAUDE_ENV_FILE exports, so the fallback applies NOW, not next launch. A
tier whose current value the ladder does not know is an operator override
and is left alone, as is a rung that cannot authenticate - pointing at an
unprobed model would be a guess wearing a gauge.

Probes retry with exponential backoff + jitter (lib-stable pRetry): one
503 flap must not read as a dead provider, and a restored provider must
not be hammered on the way back.

## Bypass

None - it only prints informational text and cannot block or mutate anything.
