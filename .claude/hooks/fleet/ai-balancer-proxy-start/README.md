# ai-balancer-proxy-start

**Type:** SessionStart hook (NUDGE - informational, never blocks).

## What it does

Starts the fleet-owned HTTP hop that transforms image inputs before they reach
a text-only model, then points ANTHROPIC_BASE_URL at it. The balancer chains:
Claude Code → :7778 (balancer) → Anthropic.

An optional interposed hop - a local middlebox that rewrites the payload on
the way upstream, prompt compression being the motivating case - can be
chained in by naming it in AI_BALANCER_UPSTREAM_HOP (`host:port`, or a bare
port for loopback). The balancer health-probes it per request and falls back
to the direct route when it is absent, so this hook does not need to know
whether one is running.

Fail-closed: if the balancer cannot start, ANTHROPIC_BASE_URL is left alone,
so a broken balancer costs the image fix, not the session. The previous
env-var write is never overwritten on failure.

## Bypass

None - it only prints informational text and cannot block or mutate anything.
