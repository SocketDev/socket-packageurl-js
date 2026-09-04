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

import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import process from 'node:process'

import { isAiBalancerEnabled } from '../_shared/balancer/detect.mts'
import { defineHook, notify, runHook } from '../_shared/guard.mts'

import {
  findRepoRoot,
  spawnDetachedServer,
} from '../../../../scripts/fleet/ai/infra.mts'
import { BALANCER_PROXY_RELATIVE_PATH } from '../../../../scripts/fleet/paths.mts'
import {
  BALANCER_PORT,
  SPAWN_POLL_INTERVAL_MS,
  SPAWN_WAIT_BUDGET_MS,
} from '../../../../scripts/fleet/balancer/fleet-ports.mts'

/**
 * The proxy script's path: repo root + `scripts/fleet/ai/balancer/proxy.mts`.
 *
 * The walk starts one level ABOVE this module's directory. Every fleet hook
 * directory carries its own private `local-*` package.json, so a walk that
 * begins here stops at THIS directory and builds
 * `<hookdir>/scripts/fleet/ai/balancer/proxy.mts`, which does not exist —
 * `spawnDetachedServer` then early-returns on the missing file and the hook
 * silently starts nothing. The bundle escaped that only because `_dist/`
 * carries no manifest of its own, so the source and bundled paths disagreed.
 *
 * Nothing between the hook dir (or `_dist/`) and the repo root carries a
 * manifest, so the parent is the first honest starting point and both layouts
 * agree. Deliberately NOT the git toplevel: that shells out at module scope,
 * which makes importing this hook do I/O.
 */
const REPO_ROOT = findRepoRoot(
  pathToFileURL(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'anchor'),
  ).href,
)

// Built from the relative path paths.mts owns, never re-spelled here. The
// hand-rolled copy still said `ai-balancer/` after the proxy moved to
// `ai/balancer/`, so spawnDetachedServer saw a missing script and returned
// silently: the hook reported success and started nothing.
const PROXY_SCRIPT = path.join(
  REPO_ROOT,
  ...BALANCER_PROXY_RELATIVE_PATH.split('/'),
)

// The probe + env-write live beside the proxy so ANY repo (fleet member or
// not) can run them as a plain script; this hook re-exports them to keep its
// historical import surface.
import {
  inspectRunningProxy,
  proxyServesRepo,
} from '../../../../scripts/fleet/ai/balancer/active-rung.mts'
import {
  balancerPrimaryProvider,
  clearBalancerBaseUrlFromEnvFile,
  probeHealth,
  retireProxy,
  writeBalancerBaseUrlToEnvFile,
} from '../../../../scripts/fleet/ai/balancer/probe.mts'
import { reviveViaService } from '../../../../scripts/fleet/ai/balancer/service.mts'

export { probeHealth, retireProxy, writeBalancerBaseUrlToEnvFile }

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

/**
 * Spawn the balancer proxy detached so it survives this hook exit.
 */
/* c8 ignore start - spawn requires a real process and port */
export function spawnDetached(revive: () => boolean = reviveViaService): void {
  // Defer to the out-of-harness supervisor when one is registered. It owns the
  // port, and a second spawn only races it: the loser dies on EADDRINUSE and
  // the supervisor is left watching a process it did not start.
  //
  // Injected so a unit test can choose the branch without a subprocess: the
  // real probe shells out to the host's service manager, which a hook spec has
  // no business reaching.
  if (revive()) {
    return
  }
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
    // Routing off means plain Anthropic: no base-URL rewrite, and no
    // proxy started for it. model-fallback strips its aliases AND the
    // settings.json ANTHROPIC_BASE_URL on the same flag, so the routing setup
    // goes quiet whole. This is also the switch that loads an organization's
    // claude.ai connectors: they are gated on there being no other auth source,
    // and only clearing the persistent settings.json base URL lets the login
    // win. A per-session env-file unset cannot do it - Claude Code applies the
    // settings.json `env` block over the shell, so the settings value wins.
    // Clear any balancer line this session's env file already carries so the
    // two writers cannot disagree.
    if (!isAiBalancerEnabled()) {
      clearBalancerBaseUrlFromEnvFile()
      return undefined
    }

    // (1) Already running — and is it OURS? A health probe only proves
    // something answers on the port. A proxy spawned from a checkout that has
    // since been deleted answers just as healthily while carrying none of the
    // policy written after it started, so liveness alone let one serve for
    // eight days. Retire a proxy that does not belong to this tree, then fall
    // through to the spawn below.
    if (await probeHealth()) {
      const running = await inspectRunningProxy()
      if (running === undefined || proxyServesRepo(running, REPO_ROOT)) {
        writeBalancerBaseUrlToEnvFile()
        return undefined
      }
      if (!(await retireProxy(running.pid))) {
        writeBalancerBaseUrlToEnvFile()
        return notify(
          `ai-balancer-proxy-start: pid ${running.pid} serves ${running.cwd ?? 'an unknown directory'}, ` +
            `not ${REPO_ROOT}, and did not exit; run \`node scripts/fleet/ai/balancer/active-rung.mts\` to inspect it.`,
        )
      }
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
