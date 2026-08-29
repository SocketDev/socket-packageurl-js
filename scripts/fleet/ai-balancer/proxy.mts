#!/usr/bin/env node
/**
 * @file The fleet-owned HTTP hop that keeps an image turn from 400ing. Sits
 *   between Claude Code and Anthropic. CHAIN: Claude Code → ai-balancer
 *   (:7778) → Anthropic. The SessionStart hook (ai-balancer-proxy-start) starts
 *   this proxy and points ANTHROPIC_BASE_URL at :7778, so every request flows
 *   through it first. An optional INTERPOSED HOP — a local middlebox that
 *   rewrites the payload on the way upstream, prompt compression being the
 *   motivating case — can be chained in by naming it in
 *   `AI_BALANCER_UPSTREAM_HOP` (`host:port`, or a bare port for loopback); the
 *   balancer health-probes it per request and falls back to the direct route
 *   when it is absent, so a configured-but-stopped hop costs nothing.
 *   KISS. One `http.createServer`, no framework. The image logic is DRY:
 *   `carriesImageInput` and `replaceImageInputs` come from
 *   `./image-inputs.mts`, the assessor from `./image-assessor.mts`, and the
 *   model and vision-equivalent picks from `../_shared/model-choices.mts`. This
 *   file is the HTTP plumbing around them. GRACEFUL DEGRADE BEFORE ERRORING. A
 *   request carrying an image is routed, in priority order: to a model that
 *   reads images natively (forward intact); to a comparable vision seat on the
 *   same provider (forward intact, model swapped); or, when no vision seat
 *   exists for the role, degraded to an OCR text assessment BEFORE it reaches
 *   the wire. An assessor that throws is replaced by a labelled placeholder, so
 *   a text-only model never receives an image. A 400 that still slips through
 *   is caught and retried once as text. FAIL OPEN, NEVER BLOCK, NEVER 400: the
 *   balancer exists to remove a 400, not to add a new way to lose a turn. A
 *   body that is not JSON, or not the messages shape, passes through untouched
 *   — `carriesImageInput` already degrades quietly on an unexpected shape.
 *   This file owns the DECISIONS — which provider serves a turn, when to retry
 *   a 400 as text, and when to walk the failover ladder. The plumbing beneath
 *   them (upstream addresses, TLS-by-port, keep-alive agents, body buffering,
 *   and piping an answer back) lives in `./transport.mts`; model mapping and
 *   credentials in `./routing.mts`; the ladder in `./failover.mts`; the error
 *   envelopes in `./balancer-errors.mts`.
 *   CLIENT FLOOR: Claude Code >= 2.1.237. Every session here runs with
 *   ANTHROPIC_BASE_URL pointed at this hop, which is the custom-base-URL path
 *   whose prompt-cache keying 2.1.237 corrects; a 2.1.236-or-earlier client
 *   serves a stale prompt through a gateway
 *   (https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21237).
 *   A stale prompt reads as a model ignoring the latest turn, so it lands as a
 *   balancer bug report rather than a client-version one.
 *   Usage: node scripts/fleet/ai-balancer/proxy.mts [--port 7778]
 */

import type { OutgoingHttpHeaders, Server } from 'node:http'
import { createServer, request as httpRequest } from 'node:http'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { isMainModule } from '../_shared/is-main-module.mts'
import { parsePortArg } from '../_shared/ai-infra.mts'
import { runMain } from '../_shared/run-main.mts'
import {
  PROVIDER_ANTHROPIC,
  PROVIDER_FIREWORKS,
} from '../_shared/offload-spend.mts'
import type { GaugeProvider } from '../_shared/offload-spend.mts'
import {
  modelReadsImages,
  visionEquivalentModel,
} from '../_shared/model-choices.mts'

const logger = getDefaultLogger()
import { carriesImageInput } from './image-inputs.mts'
import type { replaceImageInputs } from './image-inputs.mts'
import { createBalancerImageAssessor } from './image-assessor.mts'
import { anthropicToOpenAI } from './anthropic-to-openai.mts'
import {
  looksLikeContextLimitError,
  openAIErrorToAnthropic,
} from './openai-to-anthropic.mts'
import {
  balancerError,
  everyProviderRateLimitedError,
  providerStalledError,
  providerUnreachableError,
} from './balancer-errors.mts'
import {
  anthropicModelFamily,
  attachProviderCredential,
  buildImageRetryBody,
  looksLikeImageError,
  mapToPrimaryModel,
} from './routing.mts'
import {
  buildFailoverLadder as buildFailoverLadderImpl,
  primaryRequiresOpenAI,
  shouldFailover,
} from './failover.mts'
import {
  canUseTrainingModels,
  extractFilePathsFromRequest,
  filterLadderForTrainingPolicy,
  getTrainingBlockReason,
  modelTrainsOnData,
  recordFileAccesses,
} from '../_shared/model-training-policy.mts'
import {
  agentForUpstream,
  DEFAULT_PORT,
  discoverUpstream,
  HEALTH_PATH,
  OPENAI_CHAT_PATHS,
  PRIMARY_PROVIDER,
  PROVIDER_MESSAGES_PATHS,
  PROVIDER_UPSTREAMS,
  providerWireModelId,
  readBody,
  requestForUpstream,
  sendUpstreamResponse,
  transformBodyIfImage,
  UPSTREAM_STALL_TIMEOUT_MS,
  upstreamHostHeader,
} from './transport.mts'
import type { BalancerUpstream } from './transport.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'

export {
  discoverUpstream,
  odaiUpstream,
  providerWireModelId,
  readBody,
  requestForUpstream,
  sendUpstreamResponse,
  transformBodyIfImage,
  upstreamHostHeader,
} from './transport.mts'
export type { BalancerUpstream } from './transport.mts'
export {
  anthropicToOpenAI,
  flattenToolResultContent,
} from './anthropic-to-openai.mts'
export {
  buildFailoverLadder,
  failoverProviders,
  primaryRequiresOpenAI,
  shouldFailover,
} from './failover.mts'
export type { FailoverCandidate } from './failover.mts'
export {
  anthropicModelFamily,
  attachProviderCredential,
  buildImageRetryBody,
  looksLikeImageError,
  mapToPrimaryModel,
} from './routing.mts'

/**
 * Start the balancer proxy.
 *
 * The `probe` and `assessor` parameters are injected so the server is testable
 * with no network and no real vision model. In production both default to the
 * real implementations.
 */
export async function startBalancerProxy(config: {
  readonly port?: number | undefined
  readonly probe?:
    | ((upstream: { host: string; port: number }) => Promise<boolean>)
    | undefined
  readonly assessor?: Parameters<typeof replaceImageInputs>[1] | undefined
  /**
   * Overrides DEFAULT_MAX_BODY_BYTES. Tests inject a tiny value so the 413
   * path runs on a small payload.
   */
  readonly maxBodyBytes?: number | undefined
  /**
   * Overrides UPSTREAM_STALL_TIMEOUT_MS. Tests inject a tiny value so the
   * stall path runs in milliseconds instead of minutes.
   */
  readonly stallTimeoutMs?: number | undefined
  /**
   * A fixed upstream, skipping hop discovery entirely. Tests inject this so the
   * mock upstream on an ephemeral port is used directly.
   */
  readonly upstream?: { host: string; port: number } | undefined
}): Promise<Server> {
  const cfg = { __proto__: null, ...config } as typeof config
  const port = cfg.port ?? DEFAULT_PORT
  const defaultProbe = async (upstream: {
    host: string
    port: number
  }): Promise<boolean> => {
    return new Promise<boolean>(resolve => {
      const req = httpRequest(
        {
          host: upstream.host,
          path: HEALTH_PATH,
          port: upstream.port,
          timeout: 250,
        },
        res => {
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
  const probe = cfg.probe ?? defaultProbe
  const assess = cfg.assessor ?? createBalancerImageAssessor()
  const stallTimeoutMs = cfg.stallTimeoutMs ?? UPSTREAM_STALL_TIMEOUT_MS

  const server = createServer(async (req, res) => {
    // A health check answers directly — the balancer is its own health target.
    if (req.url === HEALTH_PATH) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok' }))
      return
    }

    const body = await readBody(req, { maxBytes: cfg.maxBodyBytes })
    if (body === undefined) {
      // Over the body cap: a fast 413, never a hung or bloated turn.
      res.writeHead(413, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'ai-balancer: request body too large' }))
      return
    }

    // Parse the model from the request body to decide the route. An Anthropic
    // model routes to the primary provider with its equivalent; anything else
    // passes through as usual.
    let parsed: Record<string, unknown> | undefined
    try {
      parsed = JSON.parse(body.toString('utf8')) as Record<string, unknown>
    } catch {
      // Not JSON — forward as-is to the primary provider's endpoint.
    }

    // Track file accesses for training model gating. If any path resolves to
    // a private repo, training models are blocked for the rest of the session.
    // Awaited, not fired and forgotten: the request carrying the private path
    // is the one whose model must be gated on it.
    if (parsed !== undefined) {
      const filePaths = extractFilePathsFromRequest(parsed)
      if (filePaths.length > 0) {
        await recordFileAccesses(filePaths)
      }
    }

    const model =
      typeof parsed?.['model'] === 'string' ? parsed['model'] : undefined

    // A contaminated session never reaches a provider that trains on the
    // prompt, so refuse here rather than at the ladder: the ladder only covers
    // models the balancer picks, and this one the client named itself.
    if (
      model !== undefined &&
      modelTrainsOnData(model) &&
      !canUseTrainingModels()
    ) {
      const reason = getTrainingBlockReason() ?? 'a private or unknown repo'
      res.writeHead(403, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify(
          balancerError(
            'permission_error',
            `ai-balancer refused ${model}: it trains on the prompt and this session read ${reason}. ` +
              'Fix: name a paid model, or take the training-model bypass.',
          ),
        ),
      )
      return
    }
    const family = model !== undefined ? anthropicModelFamily(model) : undefined
    const primary = PRIMARY_PROVIDER
    const isAnthropicRequest = family !== undefined
    const carriesImage = parsed !== undefined && carriesImageInput(parsed)

    let upstream = cfg.upstream ?? (await discoverUpstream(probe))
    let forwarded = body
    let transformed = false
    // Set when the request was converted to OpenAI format and rerouted to the
    // primary provider's own endpoint — the signal for the path translation
    // and the credential attach below.
    let routedToPrimary = false
    // Set when an alias model (the ladder's provider-direct rung: a provider
    // model id, not an Anthropic family) was forwarded INTACT to the
    // primary's own Anthropic-compatible endpoint — the credential attaches
    // like an offload, but neither side of the wire is converted.
    let routedAliasToPrimary = false

    if (
      primary !== PROVIDER_ANTHROPIC &&
      isAnthropicRequest &&
      model !== undefined &&
      primaryRequiresOpenAI(primary) &&
      parsed
    ) {
      // Route to the primary provider: map the Anthropic model to its
      // equivalent and convert the request to OpenAI format. The
      // `primary !== PROVIDER_ANTHROPIC` check narrows primary to GaugeProvider here.
      let primaryModel = mapToPrimaryModel(model, primary)
      let working = parsed
      // Proactive vision routing: when the request carries an image and the
      // role-equivalent model is text-only, swap to the comparable vision seat
      // on the same provider so the image reaches a model that can read it
      // instead of 400ing.
      if (
        carriesImage &&
        primaryModel !== undefined &&
        !modelReadsImages(primaryModel) &&
        family !== undefined
      ) {
        const visionModel = visionEquivalentModel(
          family,
          primary as GaugeProvider,
        )
        if (visionModel !== undefined) {
          logger.info(
            `ai-balancer: image present, swapping ${primaryModel} → ${visionModel} (vision) via ${primary}`,
          )
          primaryModel = visionModel
        }
      }
      // No vision seat for this role on this provider: degrade the image to an
      // OCR text assessment BEFORE it reaches the wire, so the text-only model
      // receives a body it can answer instead of 400ing.
      if (
        carriesImage &&
        primaryModel !== undefined &&
        !modelReadsImages(primaryModel)
      ) {
        const result = await transformBodyIfImage(body, assess)
        if (result.transformed) {
          try {
            working = JSON.parse(result.body.toString('utf8'))
            transformed = true
            logger.info(
              'ai-balancer: no vision seat for this role, transformed image to a text assessment.',
            )
          } catch {
            // result.body was valid JSON a moment ago; treat as no transform.
          }
        }
      }
      if (primaryModel !== undefined) {
        const wireModel = providerWireModelId(primaryModel, primary)
        const openaiBody = anthropicToOpenAI(working, wireModel)
        // Fireworks silently truncates by default (returns 200 with truncated
        // output) when the context is exceeded. Set the error behavior so the
        // balancer sees the 400 and can rewrite it for Claude Code's
        // auto-compaction. Other OpenAI-compatible providers ignore the flag.
        if (primary === PROVIDER_FIREWORKS) {
          ;(openaiBody as Record<string, unknown>)[
            'context_length_exceeded_behavior'
          ] = 'error'
        }
        forwarded = Buffer.from(JSON.stringify(openaiBody))
        upstream = PROVIDER_UPSTREAMS[primary] ?? upstream
        routedToPrimary = true
        if (!carriesImage) {
          logger.info(
            `ai-balancer: routing ${model} → ${wireModel} via ${primary}`,
          )
        }
      } else if (PROVIDER_MESSAGES_PATHS[primary] !== undefined) {
        // Alias model: no Anthropic-family equivalent (mapToPrimaryModel
        // returned undefined), but the primary serves an Anthropic-compatible
        // messages endpoint. Forward the body intact - no conversion in either
        // direction - with the provider credential attached. The
        // routedAliasToPrimary flag drives the credential attach, the messages
        // path rewrite, and the no-translation response arm below.
        upstream = PROVIDER_UPSTREAMS[primary] ?? upstream
        routedAliasToPrimary = true
        logger.info(`ai-balancer: routing alias ${model} intact via ${primary}`)
      }
    } else if (
      primary !== PROVIDER_ANTHROPIC &&
      !isAnthropicRequest &&
      model !== undefined &&
      parsed &&
      cfg.upstream === undefined &&
      PROVIDER_MESSAGES_PATHS[primary] !== undefined
    ) {
      // Alias-model routing: a session on the ladder's provider-direct rung
      // names a provider model (kimi-fast-latest et al.), not an Anthropic
      // family. Forward INTACT to the primary's own Anthropic-compatible
      // endpoint — no conversion in either direction, because that endpoint
      // speaks /v1/messages natively. The injected-upstream test double wins
      // over the route, so tests keep their mock. Without this branch an
      // alias session routed
      // through the balancer dies at api.anthropic.com on a model it does not
      // know. A trailing [..] suffix (Claude Code's context-window marker, as
      // in kimi-fast-latest[1m]) is NOT part of the provider's model id and
      // is stripped before forwarding — the provider 404s the bracketed form.
      const aliasWireModel = model.replace(/\[[^\]]*\]$/, '')
      if (aliasWireModel !== model) {
        forwarded = Buffer.from(
          JSON.stringify({ ...parsed, model: aliasWireModel }),
        )
      }
      upstream = PROVIDER_UPSTREAMS[primary] ?? upstream
      routedAliasToPrimary = true
      logger.info(
        `ai-balancer: routing alias ${aliasWireModel} intact via ${primary}`,
      )
    } else {
      // Anthropic primary, or a non-Anthropic request.
      if (
        carriesImage &&
        primary === PROVIDER_ANTHROPIC &&
        isAnthropicRequest
      ) {
        // Real Anthropic models read images natively: forward the body intact,
        // no OCR. Substituting here would downgrade a model that can see the
        // image into one reading a caption.
        logger.info(
          `ai-balancer: image present, forwarding intact to Anthropic ${model}`,
        )
      } else if (carriesImage) {
        const result = await transformBodyIfImage(body, assess)
        forwarded = result.body
        transformed = result.transformed
        if (transformed) {
          logger.info(
            'ai-balancer: transformed an image input to a text assessment.',
          )
        }
      }
    }

    const headers: OutgoingHttpHeaders = { ...req.headers }
    if (transformed || forwarded !== body) {
      headers['content-length'] = String(forwarded.length)
    }
    // The client's Host names the balancer, not the upstream; a remote edge
    // routes on Host, so it is rewritten to the upstream's authority.
    headers['host'] = upstreamHostHeader(upstream)
    // The provider's credential attaches HERE, server-side, and ONLY on the
    // two primary-bound routes (OpenAI offload and alias intact-forward): the
    // client's settings never carry it, and the client's own auth (its
    // Anthropic credential on an offload rung) is replaced rather than leaked
    // upstream. A passthrough request must not carry the key — it heads to
    // Anthropic's edge, and attaching would leak the Fireworks secret to a
    // third party's edge (observed live).
    if (routedToPrimary || routedAliasToPrimary) {
      await attachProviderCredential(headers, primary)
    }
    // The OpenAI-shaped primaries serve chat completions, not the Anthropic
    // messages path. The body was already converted above; the path is the
    // other half of the same translation. The alias route instead names the
    // primary's Anthropic-compatible messages path. The query string
    // (e.g. `?beta=true` from Claude Code) is stripped via URL parsing
    // but preserved on the forwarded request. Parse only when a route
    // conversion is possible.
    let path = req.url ?? '/'
    if (routedToPrimary || routedAliasToPrimary) {
      const urlPath = new URL(path, 'http://localhost').pathname
      if (urlPath === '/v1/messages') {
        path = routedToPrimary
          ? (OPENAI_CHAT_PATHS[primary] ?? path)
          : (PROVIDER_MESSAGES_PATHS[primary] ?? path)
      }
    }

    // Whether the client asked for a stream — the response translation picks
    // its SSE arm on this, so it is read from the ORIGINAL request body.
    const clientStreamed = parsed?.['stream'] === true

    // The 400-retry backstop context. Set only when an image was sent toward a
    // non-Anthropic primary (where a 400 is possible). The retry degrades the
    // image to text and re-sends to the same upstream so the turn still lands.
    const retryContext =
      carriesImage && parsed !== undefined && primary !== PROVIDER_ANTHROPIC
        ? {
            parsed,
            model,
            primary,
            upstream,
            path,
            retried: false,
            translate: routedToPrimary,
          }
        : undefined

    // The 429/529 failover context. Set when the request was routed to a
    // primary via OpenAI conversion (routedToPrimary). The failover walks the
    // provider ladder and retries on the next serving rung, preserving image
    // capability and effort. One pass per request.
    const failoverContext =
      routedToPrimary && parsed !== undefined && family !== undefined
        ? {
            carriesImage,
            family,
            model,
            parsed,
            primary: primary as BalancerUpstream,
            retried: false,
          }
        : undefined

    const upstreamReq = requestForUpstream(upstream)(
      {
        agent: agentForUpstream(upstream),
        headers,
        host: upstream.host,
        method: req.method,
        path,
        port: upstream.port,
        timeout: stallTimeoutMs,
      },
      upstreamRes => {
        const status = upstreamRes.statusCode ?? 502
        // 400-retry backstop: on an image-inputs rejection, degrade the image
        // to text and retry once on the same upstream before surfacing the
        // error. The happy path (2xx) streams unchanged; a non-image 400 is
        // surfaced untouched.
        if (
          status === 400 &&
          retryContext !== undefined &&
          !retryContext.retried
        ) {
          const chunks: Buffer[] = []
          upstreamRes.on('data', (c: Buffer) => chunks.push(c))
          upstreamRes.on('end', () => {
            void (async () => {
              const errText = Buffer.concat(chunks).toString('utf8')
              if (!looksLikeImageError(errText)) {
                // A context-limit 400 is rewritten to the Anthropic shape so
                // Claude Code's auto-compaction fires, regardless of which
                // provider returned the error. Other non-image 400s are
                // translated too when routing through an OpenAI provider,
                // so the error reaches Claude Code in Anthropic format.
                if (
                  looksLikeContextLimitError(errText) ||
                  retryContext.translate
                ) {
                  try {
                    const parsedErr = JSON.parse(errText)
                    const converted = openAIErrorToAnthropic(parsedErr)
                    if (converted !== undefined) {
                      const out = Buffer.from(JSON.stringify(converted))
                      res.writeHead(status, {
                        'content-length': String(out.length),
                        'content-type': 'application/json',
                      })
                      res.end(out)
                      return
                    }
                  } catch {
                    // Not JSON — fall through to raw pass-through.
                  }
                }
                res.writeHead(status, upstreamRes.headers)
                res.end(errText)
                return
              }
              retryContext.retried = true
              const retryBody = await buildImageRetryBody(
                retryContext.parsed,
                retryContext.model,
                retryContext.primary,
                assess,
              )
              if (retryBody === undefined) {
                res.writeHead(status, { 'content-type': 'application/json' })
                res.end(errText)
                return
              }
              const retryHeaders: OutgoingHttpHeaders = { ...req.headers }
              retryHeaders['content-length'] = String(retryBody.length)
              retryHeaders['host'] = upstreamHostHeader(retryContext.upstream)
              await attachProviderCredential(retryHeaders, retryContext.primary)
              const retryReq = requestForUpstream(retryContext.upstream)(
                {
                  agent: agentForUpstream(retryContext.upstream),
                  headers: retryHeaders,
                  host: retryContext.upstream.host,
                  method: req.method,
                  path: retryContext.path,
                  port: retryContext.upstream.port,
                  timeout: stallTimeoutMs,
                },
                retryRes => {
                  sendUpstreamResponse(retryRes, res, {
                    provider: retryContext.primary,
                    requestedModel: retryContext.model,
                    streamed: clientStreamed,
                    translate: retryContext.translate,
                  })
                },
              )
              retryReq.on('timeout', () => {
                retryReq.destroy()
                if (!res.headersSent) {
                  res.writeHead(504, { 'content-type': 'application/json' })
                  res.end(
                    JSON.stringify(
                      providerStalledError(
                        retryContext.primary,
                        retryContext.upstream,
                        stallTimeoutMs,
                      ),
                    ),
                  )
                } else {
                  res.destroy()
                }
              })
              retryReq.on('error', () => {
                if (!res.headersSent) {
                  res.writeHead(status, { 'content-type': 'application/json' })
                  res.end(errText)
                } else {
                  res.destroy()
                }
              })
              retryReq.end(retryBody)
            })().catch((err: unknown) => {
              if (!res.headersSent) {
                res.writeHead(502, { 'content-type': 'application/json' })
                res.end(
                  JSON.stringify(
                    providerUnreachableError(
                      retryContext.primary,
                      retryContext.upstream,
                      { detail: errorMessage(err) },
                    ),
                  ),
                )
              }
            })
          })
          return
        }
        // 429/529 failover: the primary is rate-limited or overloaded.
        // Walk the provider ladder and retry on the next serving rung,
        // preserving image capability and effort. One pass per request.
        if (
          shouldFailover(status) &&
          failoverContext !== undefined &&
          !failoverContext.retried &&
          routedToPrimary
        ) {
          failoverContext.retried = true
          // Drain the error body before retrying.
          upstreamRes.resume()
          const rawLadder = buildFailoverLadderImpl(
            failoverContext.family,
            failoverContext.carriesImage,
            failoverContext.primary,
            PROVIDER_UPSTREAMS,
            failoverContext.model ?? 'claude-sonnet-4-5',
          )
          // Filter out training models if any accessed repo is private.
          const ladder = filterLadderForTrainingPolicy(rawLadder)
          void (async () => {
            for (let i = 0, { length } = ladder; i < length; i += 1) {
              const candidate = ladder[i]!
              // The Anthropic floor speaks the client's own dialect: the body
              // forwards INTACT (no OpenAI hop), the path stays /v1/messages,
              // the client's own auth header is the right credential, and the
              // response needs no translation back.
              const toAnthropicFloor = candidate.primary === PROVIDER_ANTHROPIC
              let working = failoverContext.parsed
              let candidateBody = toAnthropicFloor
                ? working
                : anthropicToOpenAI(
                    working,
                    providerWireModelId(candidate.wireModel, candidate.primary),
                  )
              if (candidate.primary === PROVIDER_FIREWORKS) {
                ;(candidateBody as Record<string, unknown>)[
                  'context_length_exceeded_behavior'
                ] = 'error'
              }
              if (candidate.degradeImage && failoverContext.carriesImage) {
                const result = await transformBodyIfImage(
                  Buffer.from(JSON.stringify(candidateBody)),
                  assess,
                )
                if (result.transformed) {
                  try {
                    working = JSON.parse(result.body.toString('utf8'))
                    candidateBody = working
                  } catch {
                    // result.body was valid JSON; treat as no transform
                  }
                }
              }
              const retryBody = Buffer.from(JSON.stringify(candidateBody))
              const retryHeaders: OutgoingHttpHeaders = { ...req.headers }
              retryHeaders['content-length'] = String(retryBody.length)
              retryHeaders['host'] = upstreamHostHeader(candidate.upstream)
              if (!toAnthropicFloor) {
                await attachProviderCredential(retryHeaders, candidate.primary)
              }
              const chatPath = toAnthropicFloor
                ? path
                : (OPENAI_CHAT_PATHS[candidate.primary] ??
                  '/v1/chat/completions')
              logger.info(
                `ai-balancer: ${status} from ${failoverContext.primary}, ` +
                  `failover ${failoverContext.model} → ${candidate.wireModel} via ${candidate.primary}`,
              )
              const ok = await new Promise<boolean>(resolve => {
                const fReq = requestForUpstream(candidate.upstream)(
                  {
                    agent: agentForUpstream(candidate.upstream),
                    headers: retryHeaders,
                    host: candidate.upstream.host,
                    method: req.method,
                    path: chatPath,
                    port: candidate.upstream.port,
                    timeout: stallTimeoutMs,
                  },
                  fRes => {
                    const fStatus = fRes.statusCode ?? 502
                    if (shouldFailover(fStatus)) {
                      fRes.resume()
                      resolve(false)
                      return
                    }
                    sendUpstreamResponse(fRes, res, {
                      requestedModel: failoverContext.model,
                      streamed: clientStreamed,
                      translate: true,
                    })
                    resolve(true)
                  },
                )
                fReq.on('timeout', () => {
                  fReq.destroy()
                  resolve(false)
                })
                fReq.on('error', () => resolve(false))
                fReq.end(retryBody)
              })
              if (ok) {
                return
              }
            }
            // Every rung answered 429/529. The error names the ladder that was
            // actually walked, so the operator sees which seats were tried
            // rather than a bare "every provider" they cannot verify.
            if (!res.headersSent) {
              res.writeHead(status, { 'content-type': 'application/json' })
              res.end(
                JSON.stringify(
                  everyProviderRateLimitedError(
                    [
                      failoverContext.primary,
                      ...ladder.map(candidate => candidate.primary),
                    ],
                    status,
                  ),
                ),
              )
            }
          })().catch((err: unknown) => {
            if (!res.headersSent) {
              res.writeHead(502, { 'content-type': 'application/json' })
              res.end(
                JSON.stringify(
                  providerUnreachableError(failoverContext.primary, upstream, {
                    detail: errorMessage(err),
                  }),
                ),
              )
            }
          })
          return
        }
        sendUpstreamResponse(upstreamRes, res, {
          requestedModel: model,
          streamed: clientStreamed,
          translate: routedToPrimary,
        })
      },
    )
    upstreamReq.on('timeout', () => {
      // A silent upstream errors the turn instead of hanging it forever.
      // Once response bytes are flowing the client has the stream, so the
      // only signal left is to cut it.
      upstreamReq.destroy()
      if (!res.headersSent) {
        res.writeHead(504, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify(
            providerStalledError(primary, upstream, stallTimeoutMs),
          ),
        )
      } else {
        res.destroy()
      }
    })
    upstreamReq.on('error', (err: unknown) => {
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify(
            providerUnreachableError(primary, upstream, {
              detail: errorMessage(err),
            }),
          ),
        )
      } else {
        res.destroy()
      }
    })
    upstreamReq.end(forwarded)
  })

  server.listen(port)
  await new Promise<void>(resolve => server.on('listening', resolve))
  logger.info(`ai-balancer proxy listening on :${port}`)
  return server
}

export async function main(): Promise<number> {
  const portArg = parsePortArg(process.argv, DEFAULT_PORT)
  const server = await startBalancerProxy({ port: portArg })
  process.on('unhandledRejection', () => {
    // The async request handler catches its own throws; this guard catches
    // anything that escapes (a stray callback) so the proxy stays up.
  })
  // Keep the process alive. The proxy runs detached from the SessionStart hook.
  const shutdown = () => {
    void (async () => {
      server.close()
      await new Promise<void>(r => server.closeAllConnections?.() ?? r())
      process.exit(0)
    })()
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
  return 0
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'a fleet-owned HTTP hop that routes image turns to a vision-capable model or degrades them to text before they reach a text-only model',
  help: `Usage: node scripts/fleet/ai-balancer/proxy.mts [--port 7778]

Sits between Claude Code and api.anthropic.com. A request carrying an image is
routed to a vision-capable model when one is available, or degraded to a text
assessment before forwarding, so a text-only model stops answering 400. Fail
open: an assessor that throws leaves a labelled placeholder, never the image.`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
