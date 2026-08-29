#!/usr/bin/env node
/**
 * @file Codex-shim — a loopback-only HTTP server that exposes the OpenAI
 *   `/v1/chat/completions` API backed by `codex exec`. Codex authenticates via
 *   ChatGPT OAuth stored in `~/.codex/auth.json`; the CLI handles its own auth,
 *   so this shim needs no credential management. The balancer routes to this
 *   shim as a regular HTTP upstream on `127.0.0.1:8081`.
 *   Usage: `node codex-shim.mts [--port 8081]`
 */

import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import process from 'node:process'

import { Type } from '@sinclair/typebox'
import type { Static } from '@sinclair/typebox'

import {
  buildChatCompletionChunk,
  buildChatCompletionResponse,
  createLoopbackServer,
  extractEffort,
  extractModel,
  extractPromptFromMessages,
  extractStream,
  generateResponseId,
  handleHealthRequest,
  handleModelsRequest,
  readJsonBody,
  respondError,
  respondJson,
  spawnCli,
  SSE_DONE,
  startServer,
  stopServer,
  toSseFrame,
} from './cli-shim-shared.mts'
import type {
  ChatCompletionResponse,
  EffortLevel,
  OpenAIChatRequest,
} from './cli-shim-shared.mts'

import { parsePortArg } from '../_shared/ai-infra.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import type { ScriptMeta } from '../_shared/run-main.mts'

/**
 * The default port the codex-shim listens on.
 */
export const DEFAULT_CODEX_SHIM_PORT = 8081

/**
 * The default model the shim forwards to `codex exec`.
 */
export const DEFAULT_CODEX_MODEL = 'gpt-5.6-terra'

/**
 * The model ids the shim reports on `GET /v1/models`.
 */
export const CODEX_MODELS = ['gpt-5.6-terra'] as const

/**
 * TypeBox schema for a Codex JSONL event: `item.completed` with an
 * `agent_message` item carrying the response text.
 */
export const CodexItemEventSchema = Type.Object(
  {
    item: Type.Object(
      {
        text: Type.Optional(Type.String()),
        type: Type.String(),
      },
      { additionalProperties: true },
    ),
    type: Type.Literal('item.completed'),
  },
  { additionalProperties: true },
)
export type CodexItemEvent = Static<typeof CodexItemEventSchema>

/**
 * TypeBox schema for a Codex `turn.completed` event carrying usage.
 */
export const CodexTurnCompletedSchema = Type.Object(
  {
    type: Type.Literal('turn.completed'),
    usage: Type.Object(
      {
        cached_input_tokens: Type.Optional(Type.Integer()),
        input_tokens: Type.Optional(Type.Integer()),
        output_tokens: Type.Optional(Type.Integer()),
        reasoning_output_tokens: Type.Optional(Type.Integer()),
      },
      { additionalProperties: true },
    ),
  },
  { additionalProperties: true },
)
export type CodexTurnCompleted = Static<typeof CodexTurnCompletedSchema>

/**
 * Parse the Codex CLI's JSONL stdout into a list of item.completed events
 * and the turn.completed usage. Each line is one JSON object; lines that do
 * not parse or do not match a known event type are skipped.
 */
export function parseCodexJsonl(stdout: string): {
  readonly items: readonly CodexItemEvent[]
  readonly usage:
    | { completion_tokens: number; prompt_tokens: number }
    | undefined
} {
  const items: CodexItemEvent[] = []
  let usage: { completion_tokens: number; prompt_tokens: number } | undefined
  const lines = stdout.split(/\r?\n/)
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!.trim()
    if (line.length === 0) {
      continue
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    if (parsed === null || typeof parsed !== 'object') {
      continue
    }
    const obj = parsed as Record<string, unknown>
    if (obj['type'] === 'item.completed') {
      const item = obj['item']
      if (item !== null && typeof item === 'object') {
        const itemObj = item as Record<string, unknown>
        if (itemObj['type'] === 'agent_message') {
          items.push({
            item: {
              text: typeof itemObj['text'] === 'string' ? itemObj['text'] : '',
              type: 'agent_message',
            },
            type: 'item.completed',
          })
        }
      }
    } else if (obj['type'] === 'turn.completed') {
      const u = obj['usage']
      if (u !== null && typeof u === 'object') {
        const uo = u as Record<string, unknown>
        usage = {
          completion_tokens:
            typeof uo['output_tokens'] === 'number' ? uo['output_tokens'] : 0,
          prompt_tokens:
            typeof uo['input_tokens'] === 'number' ? uo['input_tokens'] : 0,
        }
      }
    }
  }
  return { items, usage }
}

/**
 * Concatenate all agent_message items into a single text string.
 */
export function codexItemsToText(items: readonly CodexItemEvent[]): string {
  const parts: string[] = []
  for (let i = 0, { length } = items; i < length; i += 1) {
    const text = items[i]!.item.text
    if (text !== undefined && text.length > 0) {
      parts.push(text)
    }
  }
  return parts.join('')
}

/**
 * Build the Codex CLI args for a given model + effort level.
 */
export function buildCodexArgs(
  model: string,
  effort: EffortLevel,
): readonly string[] {
  return [
    'exec',
    '-m',
    model,
    '-c',
    `model_reasoning_effort="${effort}"`,
    '-s',
    'read-only',
    '--json',
    '--skip-git-repo-check',
  ]
}

/**
 * Translate parsed Codex JSONL into a buffered OpenAI chat-completion response.
 */
export function codexJsonlToChatCompletion(
  stdout: string,
  model: string,
): ChatCompletionResponse {
  const { items, usage } = parseCodexJsonl(stdout)
  const content = codexItemsToText(items)
  return buildChatCompletionResponse({
    content,
    id: generateResponseId('chatcmpl-codex'),
    model,
    usage,
  })
}

/**
 * The HTTP request handler for the codex-shim. Exported so tests can drive
 * it without starting a server.
 */
export async function handleCodexRequest(
  _req: IncomingMessage,
  res: ServerResponse,
  body: OpenAIChatRequest,
): Promise<void> {
  const model = extractModel(body, DEFAULT_CODEX_MODEL)
  const effort = extractEffort(body)
  const prompt = extractPromptFromMessages(body.messages ?? [])
  const stream = extractStream(body)
  const args = buildCodexArgs(model, effort)

  const result = await spawnCli('codex', args, prompt)

  if (!result.ok) {
    respondError(res, result.status, result.reason)
    return
  }

  if (!stream) {
    const response = codexJsonlToChatCompletion(result.stdout, model)
    respondJson(res, 200, response)
    return

    // Streaming: parse JSONL and emit SSE chunks.
  }
  const { items } = parseCodexJsonl(result.stdout)
  const id = generateResponseId('chatcmpl-codex')
  res.writeHead(200, {
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'content-type': 'text/event-stream',
  })
  res.write(
    toSseFrame(
      buildChatCompletionChunk({
        // oxlint-disable-next-line socket/prefer-undefined-over-null -- OpenAI chat completion streaming wire format requires finish_reason: null on non-final chunks
        finishReason: null,
        id,
        model,
        role: 'assistant',
      }),
    ),
  )
  for (let i = 0, { length } = items; i < length; i += 1) {
    const text = items[i]!.item.text
    if (text !== undefined && text.length > 0) {
      res.write(
        toSseFrame(
          buildChatCompletionChunk({
            content: text,
            // oxlint-disable-next-line socket/prefer-undefined-over-null -- OpenAI chat completion streaming wire format requires finish_reason: null on non-final chunks
            finishReason: null,
            id,
            model,
          }),
        ),
      )
    }
  }
  res.write(
    toSseFrame(buildChatCompletionChunk({ finishReason: 'stop', id, model })),
  )
  res.write(SSE_DONE)
  res.end()
}

/**
 * Parse `codex doctor --json` output into a health status. The
 * `auth.credentials` check's `status` field is `'ok'` when Codex can
 * authenticate, `'warning'` or `'error'` otherwise. The `config.load` check
 * carries the configured model.
 */
export function parseCodexDoctorJson(stdout: string): {
  authStatus: 'ok' | 'missing' | 'unknown'
  model: string | undefined
} {
  try {
    const parsed: unknown = JSON.parse(stdout)
    if (parsed === null || typeof parsed !== 'object') {
      return { authStatus: 'unknown', model: undefined }
    }
    const checks = (parsed as Record<string, unknown>)['checks']
    if (checks === null || typeof checks !== 'object') {
      return { authStatus: 'unknown', model: undefined }
    }
    const checksObj = checks as Record<string, unknown>
    const auth = checksObj['auth.credentials']
    let authStatus: 'ok' | 'missing' | 'unknown' = 'unknown'
    if (auth !== null && typeof auth === 'object') {
      const status = (auth as Record<string, unknown>)['status']
      authStatus = status === 'ok' ? 'ok' : 'missing'
    }
    const config = checksObj['config.load']
    let model: string | undefined
    if (config !== null && typeof config === 'object') {
      const details = (config as Record<string, unknown>)['details']
      if (details !== null && typeof details === 'object') {
        const m = (details as Record<string, unknown>)['model']
        model = typeof m === 'string' ? m : undefined
      }
    }
    return { authStatus, model }
  } catch {
    return { authStatus: 'unknown', model: undefined }
  }
}

const HEALTH_CACHE_MS = 60_000
let healthCache:
  | {
      readonly at: number
      readonly result: {
        readonly authStatus: 'ok' | 'missing' | 'unknown'
        readonly model: string | undefined
        readonly status: 'ok' | 'degraded'
      }
    }
  | undefined

/**
 * Probe Codex health by running `codex doctor --json`. Returns a health
 * object for the `/health` endpoint. Caches for 60s so frequent health probes
 * do not spawn the CLI on every request.
 */
export async function getCodexHealth(): Promise<{
  authStatus: 'ok' | 'missing' | 'unknown'
  model: string | undefined
  status: 'ok' | 'degraded'
}> {
  if (
    healthCache !== undefined &&
    Date.now() - healthCache.at < HEALTH_CACHE_MS
  ) {
    return healthCache.result
  }
  const result = await spawnCli('codex', ['doctor', '--json'], '', {
    timeoutMs: 10_000,
  })
  if (!result.ok) {
    const degraded = {
      authStatus: 'unknown' as const,
      model: undefined,
      status: 'degraded' as const,
    }
    healthCache = { at: Date.now(), result: degraded }
    return degraded
  }
  const { authStatus, model } = parseCodexDoctorJson(result.stdout)
  const resolved = {
    authStatus,
    model,
    status: authStatus === 'ok' ? ('ok' as const) : ('degraded' as const),
  }
  healthCache = { at: Date.now(), result: resolved }
  return resolved
}

/**
 * Clear the health cache. Exported for tests.
 */
export function clearCodexHealthCache(): void {
  healthCache = undefined
}

/**
 * Create the codex-shim HTTP server.
 */
export function createCodexShimServer(): Server {
  return createLoopbackServer(async (req, res) => {
    const url = req.url ?? '/'
    if (url === '/health') {
      const health = await getCodexHealth()
      handleHealthRequest(res, health)
      return
    }
    if (url === '/v1/models') {
      handleModelsRequest(res, CODEX_MODELS)
      return
    }
    if (url === '/v1/chat/completions' && req.method === 'POST') {
      const body = await readJsonBody(req)
      if (body === null || body === undefined) {
        respondError(res, 400, 'Missing request body')
        return
      }
      await handleCodexRequest(req, res, body as OpenAIChatRequest)
      return
    }
    respondError(res, 404, 'Not found')
  })
}

/**
 * Main entry point: start the codex-shim on the given port.
 */
export async function main(): Promise<void> {
  const port = parsePortArg(process.argv, DEFAULT_CODEX_SHIM_PORT)
  const server = createCodexShimServer()
  await startServer(server, port)
  process.stdout.write(`codex-shim listening on 127.0.0.1:${port}\n`)
  const shutdown = () => {
    void stopServer(server).then(() => process.exit(0))
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'serves an OpenAI chat-completions API on loopback, backed by `codex exec`',
  help: `Usage: node scripts/fleet/ai-shims/codex-shim.mts [flags]
  --port <n>   listen port (default ${DEFAULT_CODEX_SHIM_PORT})`,
}

/* c8 ignore start - entrypoint guard */
if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
/* c8 ignore stop */
