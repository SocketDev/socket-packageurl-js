/**
 * @file How the balancer TALKS to a provider, as opposed to what it decides.
 *   Upstream addresses, the TLS-by-port client choice, keep-alive agents,
 *   request-body buffering, and piping a provider's answer back to the client
 *   (translating the OpenAI shape to the Anthropic one when the turn was
 *   offloaded) all live here. `proxy.mts` keeps the routing decisions and the
 *   server loop, and imports this for the plumbing underneath them.
 *   TLS BY UPSTREAM PORT: the remote providers listen on 443 with TLS only, so
 *   `requestForUpstream` picks node:https for them and plain HTTP for the
 *   loopback hops — node:http against a TLS port is a 400 at the edge before
 *   the body is ever read.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { Agent as httpAgent, request as httpRequest } from 'node:http'
import { Agent as httpsAgent, request as httpsRequest } from 'node:https'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { odaiServerUrl } from '../_shared/odai.mts'
import type { GaugeProvider } from '../_shared/offload-spend.mts'
import {
  PROVIDER_ANTHROPIC,
  PROVIDER_FIREWORKS,
  PROVIDER_ODAI,
  PROVIDER_OPENAI,
  PROVIDER_SYNTHETIC,
} from '../_shared/offload-spend.mts'
import {
  carriesImageInput,
  replaceImageInputs,
  replaceImageInputsWithPlaceholder,
} from './image-inputs.mts'
import { IMAGE_ASSESSOR_MODEL } from '../_shared/model-choices.mts'
import {
  createOpenAISseTranslator,
  openAIErrorToAnthropic,
  openAIToAnthropicMessage,
} from './openai-to-anthropic.mts'
import {
  providerBrokeMidResponseError,
  UNKNOWN_PROVIDER,
} from './balancer-errors.mts'

const logger = getDefaultLogger()

export const DEFAULT_PORT = 7778
export const ANTHROPIC_HOST = 'api.anthropic.com'
export const HEALTH_PATH = '/health'

/**
 * Where an Anthropic-bound request goes when no interposed hop is configured:
 * straight to the real API over TLS.
 */
export const ANTHROPIC_UPSTREAM: Readonly<{ host: string; port: number }> = {
  host: ANTHROPIC_HOST,
  port: 443,
}

/**
 * Env var naming an optional interposed hop. One reference, so the var name
 * cannot drift between the parser, the docs, and the setup hook.
 */
export const UPSTREAM_HOP_ENV = 'AI_BALANCER_UPSTREAM_HOP'

/**
 * Parse an `AI_BALANCER_UPSTREAM_HOP` value into an upstream.
 *
 * Accepts `host:port` and a bare `port` (loopback implied, the common case for
 * a local middlebox). Returns undefined for absent, blank, or unparseable
 * values — a typo must degrade to the direct route rather than send the turn to
 * port NaN.
 */
export function parseUpstreamHop(
  raw: string | undefined,
): { host: string; port: number } | undefined {
  const value = raw?.trim()
  if (!value) {
    return undefined
  }
  const colon = value.lastIndexOf(':')
  const host = colon === -1 ? 'localhost' : value.slice(0, colon)
  const portText = colon === -1 ? value : value.slice(colon + 1)
  // Reject anything that is not a plain integer: Number('') is 0 and
  // Number('80x') is NaN, and both would otherwise read as a valid port.
  if (!/^\d+$/.test(portText)) {
    return undefined
  }
  const port = Number(portText)
  if (!host || port < 1 || port > 65_535) {
    return undefined
  }
  return { host, port }
}

/**
 * Where to forward an Anthropic-bound request after the transform.
 *
 * An INTERPOSED HOP is an optional local middlebox that rewrites the payload on
 * the way upstream — a prompt-compression proxy is the motivating case. The
 * balancer chains through it when `AI_BALANCER_UPSTREAM_HOP` names one AND it
 * answers the health probe; otherwise the request goes direct.
 *
 * The probe is what makes a dead hop harmless: a configured-but-not-running
 * middlebox falls back to the direct route instead of failing every turn, so
 * the hop can be started and stopped without touching settings.
 */
export async function discoverUpstream(
  probe: (upstream: { host: string; port: number }) => Promise<boolean>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ host: string; port: number }> {
  const hop = parseUpstreamHop(env[UPSTREAM_HOP_ENV])
  if (hop && (await probe(hop))) {
    return hop
  }
  return ANTHROPIC_UPSTREAM
}

/**
 * Socket-inactivity budget for one upstream call. A silently stuck upstream
 * must never hang a turn forever — the turn errors at this bound instead.
 * Generous on purpose: a slow-prefill provider legitimately takes minutes on a
 * giant request (measured 108s for ~575k tokens non-streamed on Fireworks),
 * and a streaming or thinking upstream resets the clock with every byte, so
 * only a genuinely silent socket trips it.
 */
export const UPSTREAM_STALL_TIMEOUT_MS = 600_000

/**
 * A provider the balancer can route to: one of the offload providers (which
 * now includes `openai` via the codex-shim on :8081), the on-device odai
 * seat, or Anthropic itself (no offloading — the balancer just transforms
 * images and forwards as usual).
 */
export type BalancerUpstream =
  | GaugeProvider
  | typeof PROVIDER_ANTHROPIC
  | typeof PROVIDER_ODAI

/**
 * The primary provider the balancer routes text requests to. Read from
 * `AI_BALANCER_PRIMARY_PROVIDER`, defaulting to Fireworks — the company
 * account, the cheapest that works, and the one the operator actually bills.
 * Anthropic models are mapped to their Fireworks equivalents via
 * MODEL_EQUIVALENCE and forwarded to the primary instead of Anthropic.
 *
 * Supported primaries: `fireworks-ai` and `synthetic` (both OpenAI-compatible
 * and reachable with fleet credentials), `openai` (the Codex CLI shim on
 * loopback :8081, OpenAI-compatible, keyless — ChatGPT OAuth handled by the
 * CLI), `odai` (on-device llama-server), and `anthropic` (no offloading).
 */
export const PRIMARY_PROVIDER: BalancerUpstream =
  (process.env['AI_BALANCER_PRIMARY_PROVIDER'] as
    | BalancerUpstream
    | undefined) ?? PROVIDER_FIREWORKS

/**
 * The upstream endpoint for each supported primary provider. Anthropic is the
 * fallback — the balancer transforms images and forwards as usual. odai is
 * the on-device seat: keyless, loopback only. `openai` is the Codex CLI shim
 * on loopback :8081, wrapping `codex exec` behind the OpenAI-compatible API.
 */
export const PROVIDER_UPSTREAMS: Readonly<
  Record<string, { host: string; port: number }>
> = {
  [PROVIDER_ANTHROPIC]: { host: 'api.anthropic.com', port: 443 },
  [PROVIDER_FIREWORKS]: { host: 'api.fireworks.ai', port: 443 },
  [PROVIDER_ODAI]: odaiUpstream(),
  [PROVIDER_OPENAI]: { host: '127.0.0.1', port: 8081 },
  [PROVIDER_SYNTHETIC]: { host: 'api.synthetic.new', port: 443 },
}

/**
 * The chat-completions path each OpenAI-shaped primary serves. The request
 * body is converted to OpenAI format for these primaries; the path is the
 * other half of the same translation. The forms come from the fleet's
 * provider catalog (_shared/provider-models.mts `baseUrl`) plus
 * '/chat/completions', and the Fireworks one is verified live: its edge
 * answers a bare `/v1/messages` with 'Path not found'.
 */
export const OPENAI_CHAT_PATHS: Readonly<Record<string, string>> = {
  [PROVIDER_FIREWORKS]: '/inference/v1/chat/completions',
  [PROVIDER_ODAI]: '/v1/chat/completions',
  [PROVIDER_OPENAI]: '/v1/chat/completions',
  [PROVIDER_SYNTHETIC]: '/openai/v1/chat/completions',
}

/**
 * The Anthropic messages path an OpenAI-compat primary ALSO serves, when it
 * serves one. Fireworks' edge speaks /v1/messages natively under /inference
 * (verified live: an alias-model request there returns Anthropic-format
 * SSE), which is what makes the alias route below a forward-intact rather
 * than a conversion.
 */
export const PROVIDER_MESSAGES_PATHS: Readonly<Record<string, string>> = {
  [PROVIDER_FIREWORKS]: '/inference/v1/messages',
}

/**
 * The model id the provider's own API expects on the wire. MODEL_EQUIVALENCE
 * values carry the OpenCode provider prefix (`fireworks-ai/…`, `synthetic/…`)
 * because the catalog is shared with opencode, which addresses models by
 * `provider/id`; the provider's own API lists and serves the bare id, so the
 * prefix comes off here rather than in the catalog. Already-bare ids (odai's
 * included) pass through.
 */
export function providerWireModelId(
  model: string,
  primary: BalancerUpstream,
): string {
  const prefix = `${primary}/`
  return model.startsWith(prefix) ? model.slice(prefix.length) : model
}

/**
 * The odai llama-server endpoint as host/port, from the shared loopback URL:
 * ODAI_LLAMA_URL when it is loopback, else the CLI's default. A non-loopback
 * override is refused rather than routed — the on-device seat must never
 * become a way to send prompts off-machine.
 */
export function odaiUpstream(env: NodeJS.ProcessEnv = process.env): {
  host: string
  port: number
} {
  const url = new URL(odaiServerUrl(env))
  return { host: url.hostname, port: Number(url.port) || 8080 }
}

/**
 * One keepAlive agent per upstream host+port, so the TCP/TLS connection
 * survives between requests instead of a fresh handshake on every turn.
 * Loopback and remote both benefit: loopback skips the accept overhead,
 * remote skips the TLS round trip (measurable on api.fireworks.ai).
 */
const agentCache = new Map<string, httpAgent | httpsAgent>()

export function agentForUpstream(upstream: {
  host: string
  port: number
}): httpAgent | httpsAgent | undefined {
  const key = `${upstream.host}:${upstream.port}`
  let agent = agentCache.get(key)
  if (agent === undefined) {
    const isTls = upstream.port === 443
    agent = isTls
      ? new httpsAgent({ keepAlive: true, maxSockets: 4 })
      : new httpAgent({ keepAlive: true, maxSockets: 4 })
    agentCache.set(key, agent)
  }
  return agent
}

/**
 * Pick the HTTP or HTTPS request function for an upstream. Port 443 gets TLS;
 * plain HTTP is for the loopback hops (odai, test mocks). Every remote upstream
 * the balancer knows listens on 443 with TLS ONLY; sending node:http there is
 * the one wiring mistake this pick exists to prevent — the edge answers "the
 * plain HTTP request was sent to HTTPS port" and the turn 400s before the body
 * is even read.
 */
export function requestForUpstream(upstream: {
  host: string
  port: number
}): typeof httpRequest {
  return upstream.port === 443 ? httpsRequest : httpRequest
}

/**
 * The Host header for a forwarded request. The client's own Host names the
 * balancer (localhost:7778), and a remote edge routes on Host, so forwarding
 * it untouched sends every provider the wrong authority. Loopback hops get the
 * explicit port form; the TLS edges get the bare host on 443.
 */
export function upstreamHostHeader(upstream: {
  host: string
  port: number
}): string {
  return upstream.port === 443
    ? upstream.host
    : `${upstream.host}:${upstream.port}`
}

/**
 * Pipe an upstream response to the client, translating on the offload route.
 * A routed (OpenAI-shaped) answer is converted back to the Anthropic shape
 * the client asked in: streaming completions become Anthropic SSE event for
 * event, buffered completions and error bodies are re-shaped whole. Anything
 * that is not the expected OpenAI shape — and everything on the passthrough
 * route — forwards byte-for-byte, so a provider quirk never eats a turn.
 * Headers are rebuilt rather than copied when translating: the upstream's
 * content-length names the OpenAI body, not the Anthropic one.
 */
export function sendUpstreamResponse(
  upstreamRes: IncomingMessage,
  res: ServerResponse,
  options?:
    | {
        readonly provider?: string | undefined
        readonly requestedModel?: string | undefined
        readonly streamed?: boolean | undefined
        readonly translate?: boolean | undefined
      }
    | undefined,
): void {
  const opts = { __proto__: null, ...options } as NonNullable<typeof options>
  const status = upstreamRes.statusCode ?? 502
  const model = opts.requestedModel ?? 'unknown'
  if (opts.translate !== true) {
    res.writeHead(status, upstreamRes.headers)
    upstreamRes.pipe(res)
    return
  }
  if (status >= 200 && status < 300 && opts.streamed === true) {
    res.writeHead(status, {
      'cache-control': 'no-cache',
      'content-type': 'text/event-stream',
    })
    const translator = createOpenAISseTranslator(model)
    upstreamRes.on('error', () => translator.destroy())
    translator.on('error', () => res.destroy())
    upstreamRes.pipe(translator).pipe(res)
    return
  }
  const chunks: Buffer[] = []
  upstreamRes.on('data', (c: Buffer) => chunks.push(c))
  upstreamRes.on('end', () => {
    const raw = Buffer.concat(chunks)
    let parsed: unknown
    try {
      parsed = JSON.parse(raw.toString('utf8'))
    } catch {
      parsed = undefined
    }
    const converted =
      status >= 200 && status < 300
        ? openAIToAnthropicMessage(parsed, model)
        : openAIErrorToAnthropic(parsed)
    if (converted === undefined) {
      res.writeHead(status, upstreamRes.headers)
      res.end(raw)
      return
    }
    const out = Buffer.from(JSON.stringify(converted))
    res.writeHead(status, {
      'content-length': String(out.length),
      'content-type': 'application/json',
    })
    res.end(out)
  })
  upstreamRes.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify(
          providerBrokeMidResponseError(opts.provider ?? UNKNOWN_PROVIDER),
        ),
      )
    } else {
      res.destroy()
    }
  })
}

/**
 * The largest request body the balancer buffers, in bytes. Bodies are whole
 * in memory for the model-routing read, so a stuck local client could grow
 * the proxy's heap without bound without one. 64MB is far above the biggest
 * legitimate payload (a full-context compact request runs to the tens of
 * MB), and the cap errors the turn a fast 413 rather than ever blocking one.
 */
export const DEFAULT_MAX_BODY_BYTES = 67_108_864

/**
 * Read a request body into a Buffer, handling a streaming request. Resolves
 * undefined when the body exceeds maxBytes. The socket is NOT destroyed —
 * killing it mid-upload resets the connection before the caller's 413 can
 * reach the client; instead the stream keeps draining and further chunks
 * are discarded, so the upload completes while the response is already sent.
 */
export function readBody(
  req: IncomingMessage,
  options: { maxBytes?: number | undefined } = {},
): Promise<Buffer | undefined> {
  const { maxBytes = DEFAULT_MAX_BODY_BYTES } = options
  return new Promise(resolve => {
    const chunks: Buffer[] = []
    let total = 0
    let done = false
    const finish = (body: Buffer | undefined): void => {
      if (!done) {
        done = true
        resolve(body)
      }
    }
    req.on('data', (chunk: Buffer) => {
      total += chunk.length
      if (total > maxBytes) {
        // Over the cap: keep draining, stop accumulating.
        finish(undefined)
        return
      }
      if (!done) {
        chunks.push(chunk)
      }
    })
    req.on('end', () => finish(Buffer.concat(chunks)))
    req.on('error', () => finish(Buffer.concat(chunks)))
  })
}

/**
 * Transform a request body if it carries an image. Fail open WITHOUT forwarding
 * the image: an assessor that throws is caught and the image is replaced by a
 * labelled placeholder, so a text-only model receives text and never 400s.
 * Forwarding the original body would send the image to a model that cannot read
 * it, which is the failure the balancer exists to remove.
 */
export async function transformBodyIfImage(
  body: Buffer,
  assess: Parameters<typeof replaceImageInputs>[1],
): Promise<{ body: Buffer; transformed: boolean }> {
  let parsed: unknown
  try {
    parsed = JSON.parse(body.toString('utf8'))
  } catch {
    return { body, transformed: false }
  }
  if (!carriesImageInput(parsed)) {
    return { body, transformed: false }
  }
  try {
    const result = await replaceImageInputs(
      parsed,
      assess,
      IMAGE_ASSESSOR_MODEL,
    )
    return {
      body: Buffer.from(JSON.stringify(result.body)),
      transformed: result.replaced > 0,
    }
  } catch (e) {
    // Fail open WITHOUT forwarding the image: a text-only model would 400 on
    // it. A labelled placeholder keeps the turn landable and tells the reader
    // an image was dropped, rather than silently omitting it. The assessor's
    // error message carries What/Where/Saw/Fix and is logged for the operator.
    const reason = errorMessage(e)
    logger.warn(
      `ai-balancer: image assessment failed, substituting a placeholder. ${reason}`,
    )
    const placeholdered = replaceImageInputsWithPlaceholder(parsed, reason)
    return {
      body: Buffer.from(JSON.stringify(placeholdered.body)),
      transformed: placeholdered.replaced > 0,
    }
  }
}
