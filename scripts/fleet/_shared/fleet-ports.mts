/**
 * @file The single source of truth for every loopback port the fleet's
 *   ai-balancer stack uses. Every file that references a port imports from
 *   here — no hardcoded numbers scattered across the codebase.
 *   The ports are fixed, not configurable: the balancer, shims, and probes
 *   all need to agree on where the other is listening, and a config layer
 *   on top of fixed ports adds complexity for no operational benefit.
 *   Loopback only: these are never exposed off-machine.
 */

export const BALANCER_PORT = 7778
export const ODAI_PORT = 8080
export const CODEX_SHIM_PORT = 8081
export const CLAUDE_SHIM_PORT = 8082

export const BALANCER_BASE_URL = `http://127.0.0.1:${BALANCER_PORT}`
export const ODAI_DEFAULT_URL = `http://127.0.0.1:${ODAI_PORT}`
export const CODEX_SHIM_URL = `http://127.0.0.1:${CODEX_SHIM_PORT}`
export const CLAUDE_SHIM_URL = `http://127.0.0.1:${CLAUDE_SHIM_PORT}`

/**
 * Probe timeout for loopback health checks. 750ms is enough for a local
 * server to answer `/health` even under load, and short enough that a
 * missing server does not stall a SessionStart hook.
 */
export const PROBE_LOOPBACK_TIMEOUT_MS = 750

/**
 * Probe timeout for remote health checks. 250ms is tight — a remote edge
 * that cannot answer a HEAD in 250ms is not one to route through.
 */
export const PROBE_REMOTE_TIMEOUT_MS = 250

/**
 * Budget for waiting on a spawned server to come healthy. 2s for the
 * balancer (node startup), 3s for the shims (node + CLI binary check).
 */
export const SPAWN_WAIT_BUDGET_MS = 2000
export const SHIM_SPAWN_WAIT_BUDGET_MS = 3000
export const SPAWN_POLL_INTERVAL_MS = 100
