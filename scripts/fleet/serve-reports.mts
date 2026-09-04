#!/usr/bin/env node
/**
 * @file `serve-reports` — serve the fleet's generated reports over a stable
 *   `https://<name>.localhost` URL through portless, instead of handing out a
 *   raw `file://` path. WHY NOT `file://`. A file URL is not a stable address:
 *   it carries the author's home directory, so it is useless the moment it is
 *   pasted anywhere another machine reads. It also puts every report in one
 *   origin, so a page's `fetch` of its own sibling data is a cross-origin read
 *   from `null` and is blocked - which is what stops a report drilling into
 *   detail it has already written to disk beside itself. ONE SERVER, EVERY
 *   REPORT. It serves the reports DIRECTORY rather than one file, so a new
 *   generator gets a URL by writing into that directory and needs no wiring
 *   here. `/` resolves to the index the caller names. IT NEVER ESCAPES THE
 *   REPORTS DIRECTORY. Every request path is resolved and then checked to still
 *   be inside the root, so `..` climbs out to a 404 rather than to the home
 *   directory the reports happen to live under. Usage: node
 *   scripts/fleet/serve-reports.mts # foreground node
 *   scripts/fleet/serve-reports.mts --print-url # URL only, no serve.
 */

import { createReadStream } from 'node:fs'
import { existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { connect } from 'node:net'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { parseArgs } from 'node:util'
import { whichLocalBin } from '@socketsecurity/lib-stable/exe/path/which'
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { sleep } from '@socketsecurity/lib-stable/promises/timers'

import { isMainModule } from './process/is-main-module.mts'
import { writeModelSelection } from './ai/model-choices.mts'
import { GAUGE_PROVIDERS } from './spend/offload.mts'
import type { GaugeProvider } from './spend/offload.mts'
import { REPORTS_PORT, REPORTS_ROUTE, reportsUrl } from './reports/url.mts'
import { runMain } from './process/run-main.mts'
import { fleetReportsRoot } from './spend/report-path.mts'
import { REPO_ROOT } from './paths.mts'

import type { ScriptMeta } from './process/run-main.mts'

const logger = getDefaultLogger()

/**
 * How long to wait for a just-spawned server to bind, as polls x interval.
 */
export const SERVER_START_ATTEMPTS = 20
export const SERVER_START_POLL_MS = 100

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
}

/**
 * Resolve a request path inside `root`, or undefined when it escapes.
 *
 * The check is on the RESOLVED path rather than on the raw request, because
 * `..` is only visible as an escape after resolution - a raw-string check for
 * `..` misses an encoded one and rejects a legitimate filename containing dots.
 */
export function resolveWithinRoot(
  root: string,
  requestPath: string,
  indexName: string,
): string | undefined {
  const rel = decodeURIComponent(requestPath).replace(/^\/+/, '')
  const target = path.resolve(root, rel.length === 0 ? indexName : rel)
  if (target !== root && !target.startsWith(root + path.sep)) {
    return undefined
  }
  // An extensionless report name resolves to its .html file, so a URL like
  // /socket-lib-v7-quality-pass serves socket-lib-v7-quality-pass.html
  // without the operator typing the extension.
  if (!path.extname(target) && existsSync(`${target}.html`)) {
    return `${target}.html`
  }
  return target
}

export interface ServeConfig {
  readonly indexName: string
  readonly port: number
  readonly root: string
}

/**
 * The one route that writes rather than reads.
 */
export const MODEL_SELECT_PATH = '/api/model-selection'

/**
 * Read a bounded request body.
 *
 * Bounded because this listens on a port: an unbounded read is a memory
 * exhaustion away from taking the process down, and the payload here is two
 * short strings. The cap is generous enough that a legitimate body never hits
 * it and small enough that hitting it is a decision.
 */
export const MAX_BODY_BYTES = 4096

/**
 * Store a model choice for a provider.
 *
 * POST only, and the id is validated against the catalog before anything is
 * written - the picker offers a closed set, so a request naming something else
 * is not a user choice and must not become one. A rejected write says which
 * field was wrong without echoing the value back into the page.
 */
export function handleModelSelect(
  req: IncomingMessage,
  res: ServerResponse,
): void {
  if (req.method !== 'POST') {
    res.writeHead(405, { allow: 'POST' })
    res.end('method not allowed')
    return
  }
  let body = ''
  let aborted = false
  req.on('data', (chunk: Buffer) => {
    if (aborted) {
      return
    }
    body += chunk.toString('utf8')
    if (body.length > MAX_BODY_BYTES) {
      aborted = true
      res.writeHead(413).end('body too large')
      req.destroy()
    }
  })
  req.on('end', () => {
    if (aborted) {
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(body)
    } catch {
      res.writeHead(400).end('body must be JSON')
      return
    }
    const record =
      typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, unknown>)
        : {}
    const provider = record['provider']
    const model = record['model']
    if (typeof provider !== 'string' || typeof model !== 'string') {
      res.writeHead(400).end('provider and model must be strings')
      return
    }
    if (!GAUGE_PROVIDERS.includes(provider as GaugeProvider)) {
      res.writeHead(400).end('unknown provider')
      return
    }
    try {
      writeModelSelection(provider as GaugeProvider, model)
    } catch {
      // The catalog refused it. Not echoed back: the value came off the wire.
      res.writeHead(400).end('model is not in this provider catalog')
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
  })
}

/**
 * Start the static server. Resolves once it is listening.
 */
export async function serveReports(config: ServeConfig): Promise<() => void> {
  const { indexName, port, root } = config
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname === MODEL_SELECT_PATH) {
      handleModelSelect(req, res)
      return
    }
    const target = resolveWithinRoot(root, url.pathname, indexName)
    if (!target || !existsSync(target) || !statSync(target).isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('not found')
      return
    }
    res.writeHead(200, {
      // No caching: a report is a snapshot that is regenerated in place, and a
      // cached copy is the previous run's numbers wearing this run's URL.
      'cache-control': 'no-store',
      'content-type':
        CONTENT_TYPES[path.extname(target)] ?? 'application/octet-stream',
    })
    createReadStream(target).pipe(res)
  })
  await new Promise<void>(resolve => {
    server.listen(port, '127.0.0.1', resolve)
  })
  return () => server.close()
}

/**
 * Point the portless route at this server, reporting whether it took.
 *
 * Portless is a workspace dependency rather than a global install, so the CLI
 * comes from the repo's own `node_modules/.bin`, anchored on the repo root
 * rather than the working directory. Looking it up on PATH finds nothing on a
 * machine that never installed it globally, which is the common case and would
 * make the route silently never register.
 *
 * `alias` is the subcommand for a server portless does not itself run: it maps
 * the name to a port and leaves the process alone. `--force` lets a re-run
 * repoint an existing route instead of failing on it.
 */
export async function registerRoute(): Promise<boolean> {
  const bin = whichLocalBin('portless', { cwd: REPO_ROOT })
  if (!bin) {
    return false
  }
  try {
    await spawn(
      bin,
      ['alias', REPORTS_ROUTE, String(REPORTS_PORT), '--force'],
      { stdio: 'ignore' },
    )
    return true
  } catch {
    return false
  }
}

/**
 * True when something already answers on the reports port.
 */
export function isServerUp(port: number = REPORTS_PORT): Promise<boolean> {
  return new Promise(resolve => {
    const socket = connect({ host: '127.0.0.1', port })
    const settle = (up: boolean) => {
      socket.destroy()
      resolve(up)
    }
    socket.setTimeout(300)
    socket.once('connect', () => settle(true))
    socket.once('error', () => settle(false))
    socket.once('timeout', () => settle(false))
  })
}

/**
 * Make the portless URL live, starting the server if nothing is serving yet.
 *
 * Detached and unref'd, so the report outlives the command that generated it.
 * A reader who opens the link an hour later still gets the page; a server tied
 * to the generator's lifetime would leave a URL that worked once.
 */
export async function ensureReportsServer(): Promise<boolean> {
  if (await isServerUp()) {
    return true
  }
  try {
    const running = spawn(process.execPath, [fileURLToPath(import.meta.url)], {
      detached: true,
      stdio: 'ignore',
    })
    // The child is meant to outlive this process, so its promise never settles
    // here. Swallowing keeps a spawn failure from surfacing as an unhandled
    // rejection long after this function returned false.
    running.catch(() => {})
    running.process?.unref()
  } catch {
    return false
  }
  // Give the child its listen() before the caller hands out the URL.
  for (let attempt = 0; attempt < SERVER_START_ATTEMPTS; attempt += 1) {
    const up = await isServerUp()
    if (up) {
      return true
    }
    await sleep(SERVER_START_POLL_MS)
  }
  return false
}

export async function main(): Promise<number> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      index: { type: 'string' },
      'print-url': { type: 'boolean' },
    },
    strict: false,
  })

  if (values['print-url'] === true) {
    logger.log(reportsUrl())
    return 0
  }

  const indexName = String(values['index'] ?? 'spend-report/index.html')
  try {
    await serveReports({
      indexName,
      port: REPORTS_PORT,
      root: path.resolve(fleetReportsRoot()),
    })
  } catch (e) {
    logger.fail(`Could not start the reports server: ${errorMessage(e)}`)
    return 1
  }

  const registered = await registerRoute()
  if (!registered) {
    // A missing portless is not fatal: the server is up on its port either way,
    // and saying so beats refusing to serve at all.
    logger.warn(
      `portless did not register the route; serving on http://127.0.0.1:${REPORTS_PORT} instead.`,
    )
    return 0
  }

  logger.success(`Serving fleet reports at ${reportsUrl()}`)
  return 0
}

export const SCRIPT_META: ScriptMeta = {
  describe:
    'serves the generated fleet reports over a stable portless URL instead of a file:// path',
  help: `Usage: node scripts/fleet/serve-reports.mts [flags]

  --index NAME   what '/' resolves to (default spend-report/index.html)
  --print-url    print the URL and exit without serving

A file:// path carries the author's home directory, so it is useless the moment
it is pasted anywhere else, and it puts every report in one origin - which is
what blocks a report from fetching detail it wrote beside itself.`,
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
/* c8 ignore stop */
