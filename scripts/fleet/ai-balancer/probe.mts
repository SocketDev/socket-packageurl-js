#!/usr/bin/env node
/*
 * @file SessionStart balancer probe for ANY repo's settings.json, fleet
 *   member or not: make sure the ai-balancer proxy answers on :7778
 *   (starting it from THIS checkout when down), then append
 *   `export ANTHROPIC_BASE_URL='http://localhost:7778'` to CLAUDE_ENV_FILE so
 *   the session's model traffic — subagent fan-outs included — routes through
 *   the balancer's equivalence table instead of going provider-direct. Same
 *   contract as the fleet SessionStart hook (ai-balancer-proxy-start), but
 *   runnable as a plain script: hooks registered in a NON-member checkout
 *   (depscan et al.) point their command at this file. Fail-closed: a
 *   balancer that cannot start costs the offload, never the session — the
 *   env write is simply skipped.
 */

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { appendFileSync } from 'node:fs'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { getBuiltin } from '../../../.claude/hooks/fleet/_shared/builtin-module.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'

// oxlint-disable-next-line typescript/consistent-type-imports -- module type
type NodeHttp = typeof import('node:http')

const logger = getDefaultLogger()

const BALANCER_PORT = 7778
const HEALTH_URL = `http://localhost:${BALANCER_PORT}/health`
const PROBE_TIMEOUT_MS = 250
const SPAWN_WAIT_BUDGET_MS = 2000
const SPAWN_POLL_INTERVAL_MS = 100
const PROXY_SCRIPT = fileURLToPath(new URL('./proxy.mts', import.meta.url))

/**
 * One-shot GET of the balancer's /health. Resolves true only on 2xx. The
 * getBuiltin indirection keeps the hook test's node:http stand-in
 * authoritative.
 */
export async function probeHealth(): Promise<boolean> {
  const http = getBuiltin<NodeHttp>('node:http')
  return new Promise<boolean>(resolve => {
    const req = http.get(HEALTH_URL, { timeout: PROBE_TIMEOUT_MS }, res => {
      res.resume()
      resolve((res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300)
    })
    req.on('error', () => resolve(false))
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
  })
}

/**
 * Append the balancer base-URL export to CLAUDE_ENV_FILE. Last-write-wins
 * over any provider-direct value the user's settings set, because the env
 * file is sourced after them.
 */
export function writeBalancerBaseUrlToEnvFile(
  options?: { envFile?: string | undefined } | undefined,
): boolean {
  const opts = { __proto__: null, ...options } as {
    envFile?: string | undefined
  }
  const envFile = opts.envFile ?? process.env['CLAUDE_ENV_FILE']
  if (!envFile) {
    return false
  }
  try {
    appendFileSync(
      envFile,
      `export ANTHROPIC_BASE_URL='http://localhost:${BALANCER_PORT}'\n`,
      'utf8',
    )
    return true
  } catch {
    return false
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

export async function main(): Promise<void> {
  if (await probeHealth()) {
    if (writeBalancerBaseUrlToEnvFile()) {
      logger.log(
        '[ai-balancer] proxy healthy on :7778; session routed through it.',
      )
    }
    return
  }
  // Start the proxy detached so it survives this probe.
  const child = spawn(
    process.execPath,
    [PROXY_SCRIPT, '--port', String(BALANCER_PORT)],
    {
      detached: true,
      stdio: 'ignore',
    },
  )
  child.catch(() => undefined)
  child.process.unref()
  const deadline = Date.now() + SPAWN_WAIT_BUDGET_MS
  while (Date.now() < deadline) {
    // Serial poll of one endpoint.
    // eslint-disable-next-line no-await-in-loop -- serial poll
    await sleep(SPAWN_POLL_INTERVAL_MS)
    // eslint-disable-next-line no-await-in-loop -- serial poll
    if (await probeHealth()) {
      if (writeBalancerBaseUrlToEnvFile()) {
        logger.log(
          '[ai-balancer] started proxy on :7778; session routed through it.',
        )
      }
      return
    }
  }
  // Fail-closed: no env write, Claude Code routes provider-direct.
  logger.warn(
    '[ai-balancer] proxy did not answer — session stays provider-direct.',
  )
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'probe (and start if needed) the ai-balancer proxy, then point the session at it',
  help: 'Usage: node scripts/fleet/ai-balancer/probe.mts',
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
