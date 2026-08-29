# ai-shim-start

**Type:** SessionStart hook (NUDGE - informational, never blocks).

## What it does

Starts the codex-shim (:8081) and claude-code-shim (:8082), the loopback
HTTP servers that wrap `codex exec` and `claude -p --bare` behind the
OpenAI-compatible `/v1/chat/completions` API. The balancer routes to them
as regular HTTP upstreams, so neither the balancer nor model-fallback need
a subprocess code path.

Runs AFTER ai-balancer-proxy-start in the SessionStart chain, so the
balancer is already healthy on :7778 by the time the shims start. Each shim
is independent: a missing CLI binary or a failed health probe skips that
shim silently, never blocking the session.

Fail-open: if a shim cannot start, the balancer simply does not route to
it. The model-fallback ladder probes the shim's /health endpoint and marks
the rung `setup-missing` when it is dark, so the tier walks past it.

## Bypass

None - it only prints informational text and cannot block or mutate anything.
