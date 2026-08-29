/**
 * @file Shared utilities for the CLI shim servers (codex-shim,
 *   claude-code-shim). Each shim is a loopback-only HTTP server that speaks
 *   the OpenAI-compatible `/v1/chat/completions` API, spawns a CLI tool per
 *   request, and translates the CLI's output back into an OpenAI
 *   chat-completions response. This module holds the pieces both shims share:
 *   request parsing, response building, SSE framing, health endpoints, and
 *   the spawn runner with timeout + error mapping.
 *   KISS: one `http.createServer` per shim, no framework. DRY: every shape
 *   that appears in both shims lives here. Every function is exported so the
 *   test suite can drive them in isolation without an HTTP round trip.
 */

import type { Server } from 'node:http'
import { createServer as httpCreateServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import process from 'node:process'

import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { isSpawnError } from '@socketsecurity/lib-stable/process/spawn/errors'
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'

import { Type } from '@sinclair/typebox'
import type { Static } from '@sinclair/typebox'

/**
 * The Anthropic effort level → CLI reasoning effort mapping. Both Codex and
 * Claude Code accept a string effort level; the names differ slightly.
 */
export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type EffortLevel = (typeof EFFORT_LEVELS)[number]

/**
 * Default timeout for a CLI subprocess: 120s. A CLI that does not answer in
 * two minutes is hung, and the shim returns a 504 instead of stalling the
 * balancer's request.
 */
export const DEFAULT_SPAWN_TIMEOUT_MS = 120_000

/**
 * TypeBox schema for the OpenAI chat-completions request the shims accept.
 * Only the fields the shim reads: `model`, `messages`, `stream`, `max_tokens`.
 */
export const OpenAIChatRequestSchema = Type.Object(
  {
    max_tokens: Type.Optional(Type.Integer()),
    messages: Type.Array(
      Type.Object(
        {
          content: Type.Union([Type.String(), Type.Array(Type.Unknown())]),
          role: Type.String(),
        },
        { additionalProperties: true },
      ),
    ),
    model: Type.Optional(Type.String()),
    stream: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: true },
)
export type OpenAIChatRequest = Static<typeof OpenAIChatRequestSchema>

/**
 * TypeBox schema for one OpenAI chat-completions message.
 */
export const ChatMessageSchema = Type.Object(
  {
    content: Type.Union([Type.String(), Type.Array(Type.Unknown())]),
    role: Type.String(),
  },
  { additionalProperties: true },
)
export type ChatMessage = Static<typeof ChatMessageSchema>

/**
 * One entry in a chat-completions response's `choices` array.
 */
export interface ChatChoice {
  readonly finish_reason: string
  readonly index: number
  readonly message: { content: string; role: string }
}

/**
 * The OpenAI chat-completions response shape the shims return.
 */
export interface ChatCompletionResponse {
  readonly choices: readonly ChatChoice[]
  readonly created: number
  readonly id: string
  readonly model: string
  readonly object: 'chat.completion'
  readonly usage: { completion_tokens: number; prompt_tokens: number }
}

/**
 * One SSE chunk in a streaming chat-completions response.
 */
export interface ChatCompletionChunk {
  readonly choices: readonly [
    {
      readonly delta: {
        content?: string | undefined
        role?: string | undefined
      }
      readonly finish_reason: string | null
      readonly index: number
    },
  ]
  readonly created: number
  readonly id: string
  readonly model: string
  readonly object: 'chat.completion.chunk'
}

/**
 * Extract the prompt text from an OpenAI chat-completions request's messages
 * array. Concatenates all user messages' text content into a single string,
 * separated by newlines. System messages become a `System: <text>` prefix so
 * the CLI sees the instruction. Assistant messages become `Assistant:
 * <text>` for multi-turn context. Non-text content (images) is skipped — the
 * balancer's image-to-text assessment runs before the request reaches the shim.
 */
export function extractPromptFromMessages(
  messages: readonly ChatMessage[],
): string {
  const lines: string[] = []
  for (let i = 0, { length } = messages; i < length; i += 1) {
    const msg = messages[i]!
    const text = messageToText(msg)
    if (text.length === 0) {
      continue
    }
    if (msg.role === 'system') {
      lines.push(`System: ${text}`)
    } else if (msg.role === 'assistant') {
      lines.push(`Assistant: ${text}`)
    } else {
      lines.push(text)
    }
  }
  return lines.join('\n')
}

/**
 * Flatten one message's content to plain text. String content passes through;
 * an array of content blocks extracts `text` blocks and skips everything
 * else (images, tool results).
 */
export function messageToText(message: ChatMessage): string {
  const content = message.content
  if (typeof content === 'string') {
    return content
  }
  if (Array.isArray(content)) {
    const parts: string[] = []
    for (let i = 0, { length } = content; i < length; i += 1) {
      const block = content[i]
      if (
        block !== null &&
        typeof block === 'object' &&
        (block as Record<string, unknown>)['type'] === 'text'
      ) {
        const t = (block as Record<string, unknown>)['text']
        if (typeof t === 'string') {
          parts.push(t)
        }
      }
    }
    return parts.join('')
  }
  return ''
}

/**
 * Extract the model name from an OpenAI chat-completions request, falling back
 * to a default when absent.
 */
export function extractModel(
  body: OpenAIChatRequest,
  fallback: string,
): string {
  return body.model ?? fallback
}

/**
 * Extract the `stream` flag from an OpenAI chat-completions request.
 */
export function extractStream(body: OpenAIChatRequest): boolean {
  return body.stream === true
}

/**
 * Extract the effort level from an OpenAI chat-completions request. The
 * OpenAI API does not carry effort in the request body, so the balancer
 * passes it as a custom `reasoning_effort` field (matching OpenAI's own
 * extension). Falls back to `medium`.
 */
export function extractEffort(body: OpenAIChatRequest): EffortLevel {
  const raw = (body as Record<string, unknown>)['reasoning_effort']
  if (typeof raw === 'string') {
    for (let i = 0, { length } = EFFORT_LEVELS; i < length; i += 1) {
      if (EFFORT_LEVELS[i] === raw) {
        return raw as EffortLevel
      }
    }
  }
  return 'medium'
}

/**
 * Build a buffered (non-streaming) OpenAI chat-completions response.
 */
export function buildChatCompletionResponse(params: {
  content: string
  id: string
  model: string
  usage?: { completion_tokens: number; prompt_tokens: number } | undefined
}): ChatCompletionResponse {
  return {
    choices: [
      {
        finish_reason: 'stop',
        index: 0,
        message: { content: params.content, role: 'assistant' },
      },
    ],
    created: Math.floor(Date.now() / 1000),
    id: params.id,
    model: params.model,
    object: 'chat.completion',
    usage: params.usage ?? { completion_tokens: 0, prompt_tokens: 0 },
  }
}

/**
 * Build one SSE chunk for a streaming chat-completions response.
 */
export function buildChatCompletionChunk(params: {
  content?: string | undefined
  finishReason: string | null
  id: string
  model: string
  role?: string | undefined
}): ChatCompletionChunk {
  const delta: { content?: string | undefined; role?: string | undefined } = {}
  if (params.content !== undefined) {
    delta.content = params.content
  }
  if (params.role !== undefined) {
    delta.role = params.role
  }
  return {
    choices: [
      {
        delta,
        finish_reason: params.finishReason,
        index: 0,
      },
    ],
    created: Math.floor(Date.now() / 1000),
    id: params.id,
    model: params.model,
    object: 'chat.completion.chunk',
  }
}

/**
 * Serialize a chunk to an SSE frame string.
 */
export function toSseFrame(chunk: ChatCompletionChunk): string {
  return `data: ${JSON.stringify(chunk)}\n\n`
}

/**
 * The terminal SSE frame: `data: [DONE]\n\n`.
 */
export const SSE_DONE = 'data: [DONE]\n\n'

/**
 * Generate a unique response id, prefixed with the shim name.
 */
export function generateResponseId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Read and parse the JSON body of an incoming HTTP request. Returns undefined
 * on a parse error.
 */
export function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise(resolve => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve(text.length > 0 ? JSON.parse(text) : undefined)
      } catch {
        resolve(undefined)
      }
    })
    req.on('error', () => resolve(undefined))
  })
}

/**
 * Respond with a JSON body and status code.
 */
export function respondJson(
  res: ServerResponse,
  status: number,
  body: unknown,
): void {
  const json = JSON.stringify(body)
  res.writeHead(status, {
    'content-length': String(Buffer.byteLength(json)),
    'content-type': 'application/json',
  })
  res.end(json)
}

/**
 * Respond with an OpenAI-shaped error.
 */
export function respondError(
  res: ServerResponse,
  status: number,
  message: string,
): void {
  respondJson(res, status, {
    error: { code: status, message, type: 'internal_error' },
  })
}

/**
 * The static `/v1/models` response for a shim. Returns the model ids the shim
 * can serve.
 */
export function handleModelsRequest(
  res: ServerResponse,
  modelIds: readonly string[],
): void {
  respondJson(res, 200, {
    data: modelIds.map(id => ({ id, object: 'model' })),
    object: 'list',
  })
}

/**
 * The `/health` endpoint: 200 OK with a JSON body carrying the CLI's auth
 * status. `authStatus` is `'ok'` when the CLI can authenticate, `'missing'`
 * when credentials are absent, and `'unknown'` when the check could not run.
 * The `model` field echoes the CLI's configured model when available.
 */
export function handleHealthRequest(
  res: ServerResponse,
  health: {
    readonly authStatus: 'ok' | 'missing' | 'unknown'
    readonly model?: string | undefined
    readonly status: 'ok' | 'degraded'
  } = { authStatus: 'unknown', status: 'ok' },
): void {
  respondJson(res, 200, health)
}

/**
 * One CLI spawn's outcome: the stdout text on exit 0, else the mapped error.
 */
export type CliSpawnResult =
  | { readonly ok: true; readonly stdout: string }
  | { readonly ok: false; readonly reason: string; readonly status: number }

/**
 * Spawn a CLI tool, pipe the prompt to stdin, and collect stdout. Maps
 * spawn errors (ENOENT, timeout) and non-zero exits to a `CliSpawnResult`
 * error shape so the HTTP handler never throws.
 */
export async function spawnCli(
  command: string,
  args: readonly string[],
  prompt: string,
  options: {
    readonly env?: NodeJS.ProcessEnv | undefined
    readonly timeoutMs?: number | undefined
  } = {},
): Promise<CliSpawnResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_SPAWN_TIMEOUT_MS
  try {
    const result = spawn(command, [...args], {
      env: options.env,
      stdioString: true,
      timeout: timeoutMs,
    })
    const childStdin = result.process.stdin
    if (childStdin) {
      childStdin.write(prompt)
      childStdin.end()
    }
    const { code, stdout, stderr } = await result
    if (code !== 0) {
      const reason =
        typeof stderr === 'string' && stderr.length > 0
          ? firstLine(stderr)
          : `CLI exited with code ${code}`
      return { ok: false, reason, status: 502 }
    }
    return { ok: true, stdout: typeof stdout === 'string' ? stdout : '' }
  } catch (e) {
    if (isSpawnError(e)) {
      if (typeof e.code === 'string') {
        return {
          ok: false,
          reason: `CLI not runnable: ${e.code}`,
          status: 503,
        }
      }
      return {
        ok: false,
        reason: firstLine(typeof e.stderr === 'string' ? e.stderr : ''),
        status: 502,
      }
    }
    return {
      ok: false,
      reason: errorMessage(e),
      status: 500,
    }
  }
}

/**
 * Extract the first non-empty line of a string.
 */
export function firstLine(text: string): string {
  const trimmed = text.trim()
  const nl = trimmed.indexOf('\n')
  return nl === -1 ? trimmed : trimmed.slice(0, nl)
}

/**
 * A loopback-only HTTP server. The shim binds to `127.0.0.1` so no request
 * can reach it from outside the machine.
 */
export function createLoopbackServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Server {
  return httpCreateServer(handler)
}

/**
 * Start a loopback server on the given port and return a promise that
 * resolves when the server is listening.
 */
export function startServer(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve()
    })
  })
}

/**
 * Stop a server, ignoring errors when it is already stopped.
 */
export function stopServer(server: Server): Promise<void> {
  return new Promise(resolve => {
    server.close(() => resolve())
  })
}

/**
 * Whether a loopback port answers its `/health` endpoint. Used by the
 * SessionStart hook to probe whether a shim is already running before
 * spawning a new one.
 */
export function probeHealth(port: number): Promise<boolean> {
  const http = process.getBuiltinModule('node:http')
  return new Promise(resolve => {
    const req = http.get(
      `http://127.0.0.1:${port}/health`,
      { timeout: 750 },
      (res: IncomingMessage) => {
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
 * The loopback hostname every shim binds to.
 */
export const LOOPBACK_HOST = '127.0.0.1' as const

/**
 * Resolve a shim's base URL from its port.
 */
export function shimBaseUrl(port: number): string {
  return `http://${LOOPBACK_HOST}:${port}`
}
