// Claude Code SessionStart hook — ai-balancer proxy auto-start.
// Starts the fleet-owned HTTP hop that transforms image inputs before they reach
// a text-only model, then points ANTHROPIC_BASE_URL at it. The balancer chains:
// Claude Code → :7778 (balancer) → Anthropic.
//
// An optional interposed hop — a local middlebox that rewrites the payload on
// the way upstream, prompt compression being the motivating case — can be
// chained in by naming it in AI_BALANCER_UPSTREAM_HOP (`host:port`, or a bare
// port for loopback). The balancer health-probes it per request and falls back
// to the direct route when it is absent, so this hook does not need to know
// whether one is running.
//
// Fail-closed: if the balancer cannot start, ANTHROPIC_BASE_URL is left alone,
// so a broken balancer costs the image fix, not the session. The previous
// env-var write is never overwritten on failure.

import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { isPlainObject } from '@socketsecurity/lib-stable/objects/predicates'

import { balancerModeIsOff } from '../_shared/balancer-mode.mts'
import { defineHook, notify, runHook } from '../_shared/guard.mts'

import {
  findRepoRoot,
  spawnDetachedServer,
} from '../../../../scripts/fleet/_shared/ai-infra.mts'
import {
  BALANCER_PORT,
  SPAWN_POLL_INTERVAL_MS,
  SPAWN_WAIT_BUDGET_MS,
} from '../../../../scripts/fleet/_shared/fleet-ports.mts'

/**
 * The proxy script's path: repo root + `scripts/fleet/ai-balancer/proxy.mts`.
 */
const PROXY_SCRIPT = path.join(
  findRepoRoot(import.meta.url),
  'scripts',
  'fleet',
  'ai-balancer',
  'proxy.mts',
)

// The probe + env-write live beside the proxy so ANY repo (fleet member or
// not) can run them as a plain script; this hook re-exports them to keep its
// historical import surface.
import {
  probeHealth,
  writeBalancerBaseUrlToEnvFile,
} from '../../../../scripts/fleet/ai-balancer/probe.mts'

export { probeHealth, writeBalancerBaseUrlToEnvFile }

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

/**
 * Read `AI_BALANCER_PRIMARY_PROVIDER` from `~/.claude/settings.json` so the
 * spawned proxy routes through the provider the model-fallback hook chose.
 * The hook process's own env does not carry it: model-fallback writes the
 * value to settings.json and CLAUDE_ENV_FILE, neither of which reaches this
 * hook's process.env at spawn time.
 */
function balancerPrimaryProvider(): string | undefined {
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json')
  try {
    const parsed: unknown = JSON.parse(readFileSync(settingsPath, 'utf8'))
    if (!isPlainObject(parsed)) {
      return undefined
    }
    const env = parsed['env']
    if (!isPlainObject(env)) {
      return undefined
    }
    const value = env['AI_BALANCER_PRIMARY_PROVIDER']
    return typeof value === 'string' ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * Spawn the balancer proxy detached so it survives this hook exit.
 */
/* c8 ignore start - spawn requires a real process and port */
export function spawnDetached(): void {
  const spawnEnv: Record<string, string | undefined> = { ...process.env }
  const primary = balancerPrimaryProvider()
  if (primary !== undefined) {
    spawnEnv['AI_BALANCER_PRIMARY_PROVIDER'] = primary
  }
  spawnDetachedServer(PROXY_SCRIPT, ['--port', String(BALANCER_PORT)], spawnEnv)
}
/* c8 ignore stop */

export const hook = defineHook({
  /* c8 ignore start - check() orchestrates real machine state */
  check: async () => {
    // AI_BALANCER_MODE=off means plain Anthropic: no base-URL rewrite, and no
    // proxy started for it. model-fallback strips its aliases on the same
    // flag, so the two halves of the routing setup go quiet together rather
    // than leaving a session pointed at aliases with no balancer to serve
    // them.
    if (balancerModeIsOff()) {
      return undefined
    }

    // (1) Already running?
    if (await probeHealth()) {
      writeBalancerBaseUrlToEnvFile()
      return undefined
    }

    // (2) Start it + wait for health.
    spawnDetached()
    const deadline = Date.now() + SPAWN_WAIT_BUDGET_MS
    while (Date.now() < deadline) {
      await sleep(SPAWN_POLL_INTERVAL_MS)
      if (await probeHealth()) {
        writeBalancerBaseUrlToEnvFile()
        return undefined
      }
    }

    // Spawn fired but didn't come healthy. Fail-closed: the existing URL stays.
    return notify(
      `ai-balancer-proxy-start: proxy failed to become healthy within ${SPAWN_WAIT_BUDGET_MS}ms; ` +
        `ANTHROPIC_BASE_URL left unchanged.`,
    )
  },
  /* c8 ignore stop */
  event: 'SessionStart',
  type: 'nudge',
})

void runHook(hook, import.meta.url)
