/**
 * @file Shared infrastructure helpers used across the ai-balancer, CLI
 *   shims, and SessionStart hooks: HTTP health probing, detached server
 *   spawning, repo-root resolution, port-arg parsing, and string utils.
 *   Every function is self-contained on Node builtins + lib-stable so it
 *   works in the hook bundle (no node_modules at runtime).
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { PROBE_LOOPBACK_TIMEOUT_MS } from './fleet-ports.mts'

/**
 * Probe an HTTP URL and return true when it answers 2xx. Generic across
 * loopback and remote: the caller picks the URL and timeout. Replaces four
 * near-identical inline implementations.
 */
export function probeHttpOk(
  url: string,
  options?: { timeoutMs?: number | undefined } | undefined,
): Promise<boolean> {
  const { timeoutMs = PROBE_LOOPBACK_TIMEOUT_MS } = {
    __proto__: null,
    ...options,
  } as NonNullable<typeof options>
  const http = process.getBuiltinModule('node:http')
  const https = process.getBuiltinModule('node:https')
  const client = url.startsWith('https://') ? https : http
  return new Promise(resolve => {
    const req = client.get(
      url,
      { timeout: timeoutMs },
      (res: { resume: () => void; statusCode?: number | undefined }) => {
        res.resume()
        resolve((res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300)
      },
    )
    req.on('error', () => resolve(false))
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
  })
}

/**
 * Spawn a long-running server script detached so it survives the caller's
 * exit. The caller's env is inherited. Replaces four identical
 * spawn(detached) + catch + unref blocks.
 */
export function spawnDetachedServer(
  script: string,
  args: readonly string[],
  env?: NodeJS.ProcessEnv | undefined,
): void {
  if (!existsSync(script)) {
    return
  }
  const result = spawn(process.execPath, [script, ...args], {
    detached: true,
    env: env ?? process.env,
    stdio: 'ignore',
  })
  result.catch(() => undefined)
  result.process.unref()
}

/**
 * Walk up from a module's URL to the first directory containing a
 * `package.json` — the repo root. Returns the repo root path, or the
 * starting directory if no `package.json` is found within 8 levels.
 */
export function findRepoRoot(fromUrl: string): string {
  let dir = path.dirname(fileURLToPath(fromUrl))
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(path.join(dir, 'package.json'))) {
      return dir
    }
    const parent = path.dirname(dir)
    if (parent === dir) {
      break
    }
    dir = parent
  }
  return dir
}

/**
 * Parse `--port=N` or `--port N` from an argv array. Returns the fallback
 * when neither form is present.
 */
export function parsePortArg(
  argv: readonly string[],
  fallback: number,
): number {
  for (let i = 0, { length } = argv; i < length; i += 1) {
    const arg = argv[i]!
    if (arg.startsWith('--port=')) {
      const n = Number(arg.slice(7))
      if (Number.isFinite(n) && n > 0) {
        return n
      }
    }
    if (arg === '--port' && i + 1 < argv.length) {
      const n = Number(argv[i + 1])
      if (Number.isFinite(n) && n > 0) {
        return n
      }
    }
  }
  return fallback
}

/**
 * Extract the first non-empty line of a string, optionally capped at
 * `maxLen` characters. Replaces two divergent implementations.
 */
export function firstLine(
  text: string,
  options?: { maxLen?: number | undefined } | undefined,
): string {
  const { maxLen = 200 } = { __proto__: null, ...options } as NonNullable<
    typeof options
  >
  const trimmed = text.trim()
  const nl = trimmed.indexOf('\n')
  const line = nl === -1 ? trimmed : trimmed.slice(0, nl)
  return line.length > maxLen ? `${line.slice(0, maxLen)}…` : line
}

/**
 * Strip Claude Code's context-window suffix (`[1m]`, `[2m]`, etc.) from a
 * model id. The bracketed suffix is not part of the provider's model id.
 */
export function stripContextSuffix(modelId: string): string {
  return modelId.replace(/\[[^\]]*\]$/, '')
}
