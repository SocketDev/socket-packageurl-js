// Claude Code SessionStart hook — CLI shim auto-start.
// Starts the codex-shim (:8081) and claude-code-shim (:8082), the loopback
// HTTP servers that wrap `codex exec` and `claude -p --bare` behind the
// OpenAI-compatible `/v1/chat/completions` API. The balancer routes to them
// as regular HTTP upstreams, so neither the balancer nor model-fallback need
// a subprocess code path.
//
// Runs AFTER ai-balancer-proxy-start in the SessionStart chain, so the
// balancer is already healthy on :7778 by the time the shims start. Each shim
// is independent: a missing CLI binary or a failed health probe skips that
// shim silently, never blocking the session.
//
// Fail-open: if a shim cannot start, the balancer simply does not route to
// it. The model-fallback ladder probes the shim's /health endpoint and marks
// the rung `setup-missing` when it is dark, so the tier walks past it.

import path from 'node:path'

import { defineHook, notify, runHook } from '../_shared/guard.mts'
import {
  findRepoRoot,
  probeHttpOk,
  spawnDetachedServer,
} from '../../../../scripts/fleet/_shared/ai-infra.mts'
import {
  CLAUDE_SHIM_PORT,
  CODEX_SHIM_PORT,
  SHIM_SPAWN_WAIT_BUDGET_MS as SPAWN_WAIT_BUDGET_MS,
  SPAWN_POLL_INTERVAL_MS,
} from '../../../../scripts/fleet/_shared/fleet-ports.mts'

export { CODEX_SHIM_PORT, CLAUDE_SHIM_PORT, probeHttpOk }

/**
 * One shim's startup config: its port, the CLI binary it needs, and the
 * script that starts the server.
 */
interface ShimSpec {
  readonly name: string
  readonly port: number
  readonly scriptPath: string
}

const SHIMS_DIR = path.join(
  findRepoRoot(import.meta.url),
  'scripts',
  'fleet',
  'ai-shims',
)

/**
 * The shims this hook starts. Each is a detached node process running the
 * shim script with `--port=<port>`.
 */
function shimSpecs(): readonly ShimSpec[] {
  return [
    {
      name: 'codex-shim',
      port: CODEX_SHIM_PORT,
      scriptPath: path.join(SHIMS_DIR, 'codex-shim.mts'),
    },
    {
      name: 'claude-code-shim',
      port: CLAUDE_SHIM_PORT,
      scriptPath: path.join(SHIMS_DIR, 'claude-code-shim.mts'),
    },
  ]
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

/**
 * Spawn one shim server detached so it survives this hook exit. The spawned
 * process inherits the hook's env, which is sufficient — the shims read
 * credentials from the keychain, not from env vars.
 */
/* c8 ignore start - spawn requires a real process and port */
export function spawnShimDetached(spec: ShimSpec): void {
  spawnDetachedServer(spec.scriptPath, [`--port=${spec.port}`])
}
/* c8 ignore stop */

/**
 * Start one shim: probe first (already running?), then spawn + wait for
 * health. Returns a notify line when the shim failed to start, undefined
 * when it is healthy or the script is absent (not installed).
 */
async function ensureShim(spec: ShimSpec): Promise<string | undefined> {
  if (await probeHttpOk(`http://127.0.0.1:${spec.port}/health`)) {
    return undefined
  }
  spawnShimDetached(spec)
  const deadline = Date.now() + SPAWN_WAIT_BUDGET_MS
  while (Date.now() < deadline) {
    await sleep(SPAWN_POLL_INTERVAL_MS)
    if (await probeHttpOk(`http://127.0.0.1:${spec.port}/health`)) {
      return undefined
    }
  }
  return `[ai-shim-start] ${spec.name} failed to become healthy on :${spec.port}`
}

export const hook = defineHook({
  /* c8 ignore start - check() orchestrates real machine state */
  check: async () => {
    const specs = shimSpecs()
    const failures: string[] = []
    for (let i = 0, { length } = specs; i < length; i += 1) {
      const failure = await ensureShim(specs[i]!)
      if (failure !== undefined) {
        failures.push(failure)
      }
    }
    if (failures.length === 0) {
      return undefined
    }
    return notify(failures.join('; '))
  },
  /* c8 ignore stop */
  event: 'SessionStart',
  type: 'nudge',
})

void runHook(hook, import.meta.url)
