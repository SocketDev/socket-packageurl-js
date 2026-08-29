#!/usr/bin/env node
/**
 * @file Claude-code-shim — a loopback-only HTTP server that exposes the
 *   OpenAI `/v1/chat/completions` API backed by `claude -p --bare`. Claude
 *   Code authenticates via Anthropic OAuth stored in the macOS keychain; the
 *   shim reads the token at startup and passes it as `ANTHROPIC_API_KEY` in
 *   the spawned process env. The `--bare` flag prevents `claude -p` from
 *   reading `~/.claude/settings.json`. Reading that file would loop the call
 *   back through the balancer. The balancer routes to this shim on
 *   `127.0.0.1:8082`.
 *   Usage: `node claude-code-shim.mts [--port 8082]`
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
import { readCredential } from '../_shared/provider-credentials.mts'

/**
 * The default port the claude-code-shim listens on.
 */
export const DEFAULT_CLAUDE_SHIM_PORT = 8082

/**
 * The default model the shim forwards to `claude -p`.
 */
export const DEFAULT_CLAUDE_MODEL = 'sonnet'

/**
 * The model ids the shim reports on `GET /v1/models`.
 */
export const CLAUDE_MODELS = ['haiku', 'sonnet', 'opus', 'fable'] as const

/**
 * The keychain service + account where Claude Code stores its OAuth token.
 *
 * Declared by the credential registry, which names them in the slot this shim
 * reads, and re-exported here for the callers that already ask the shim.
 */
export {
  CLAUDE_KEYCHAIN_ACCOUNT,
  CLAUDE_KEYCHAIN_SERVICE,
} from '../_shared/provider-credentials.mts'

/**
 * TypeBox schema for the Claude Code `--output-format json` result.
 */
export const ClaudeCodeResultSchema = Type.Object(
  {
    is_error: Type.Optional(Type.Boolean()),
    result: Type.Optional(Type.String()),
    type: Type.Optional(Type.String()),
    usage: Type.Optional(
      Type.Object(
        {
          input_tokens: Type.Optional(Type.Integer()),
          output_tokens: Type.Optional(Type.Integer()),
        },
        { additionalProperties: true },
      ),
    ),
  },
  { additionalProperties: true },
)
export type ClaudeCodeResult = Static<typeof ClaudeCodeResultSchema>

/**
 * Pull the access token out of a stored Claude credential.
 *
 * Two shapes reach here. The keychain holds Claude Code's own JSON envelope,
 * where the JWT sits under `claudeAiOauth.accessToken`. The environment
 * override holds the bare token, because pasting a JSON envelope into a shell
 * variable is a worse path than pasting the token it wraps. A value opening
 * with `{` is read ONLY as the envelope, so a malformed envelope resolves to
 * undefined rather than being sent upstream as a bearer token.
 */
export function extractOauthAccessToken(raw: string): string | undefined {
  if (!raw.startsWith('{')) {
    return raw
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (parsed === null || typeof parsed !== 'object') {
    return undefined
  }
  const oauth = (parsed as Record<string, unknown>)['claudeAiOauth']
  if (oauth === null || typeof oauth !== 'object') {
    return undefined
  }
  const token = (oauth as Record<string, unknown>)['accessToken']
  return typeof token === 'string' ? token : undefined
}

/**
 * Read the Anthropic OAuth token for the spawned `claude -p` process.
 *
 * Routed through `readCredential` rather than reading the keychain directly: a
 * keychain read raises an OS auth prompt, which under a test runner blocks
 * until the suite times out on a correctly configured machine. That helper
 * short-circuits before it reaches the keychain when a test runner is driving.
 * Returns undefined when no source has it, which every caller treats as
 * "unauthenticated" rather than an error.
 */
export async function readClaudeOauthToken(): Promise<string | undefined> {
  const raw = await readCredential('claudeOauthToken')
  return typeof raw === 'string' && raw.length > 0
    ? extractOauthAccessToken(raw)
    : undefined
}

/**
 * Parse the Claude Code CLI's JSON stdout into a result object. Returns
 * undefined when the output is not valid JSON.
 */
export function parseClaudeCodeJson(
  stdout: string,
): ClaudeCodeResult | undefined {
  const trimmed = stdout.trim()
  if (trimmed.length === 0) {
    return undefined
  }
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (parsed === null || typeof parsed !== 'object') {
      return undefined
    }
    return parsed as ClaudeCodeResult
  } catch {
    return undefined
  }
}

/**
 * Translate a parsed Claude Code result into a buffered OpenAI
 * chat-completion response.
 */
export function claudeCodeJsonToChatCompletion(
  result: ClaudeCodeResult,
  model: string,
): ChatCompletionResponse {
  const content = result.result ?? ''
  const usage = result.usage
  return buildChatCompletionResponse({
    content,
    id: generateResponseId('chatcmpl-claude'),
    model,
    usage:
      usage !== undefined
        ? {
            completion_tokens: usage.output_tokens ?? 0,
            prompt_tokens: usage.input_tokens ?? 0,
          }
        : undefined,
  })
}

/**
 * Build the Claude Code CLI args for a given model + effort level.
 * `--bare` skips settings.json, keychain, and hooks (avoids balancer loop).
 * `--dangerously-skip-permissions` runs non-interactively.
 */
export function buildClaudeArgs(
  model: string,
  effort: EffortLevel,
): readonly string[] {
  return [
    '-p',
    '--bare',
    '--model',
    model,
    '--output-format',
    'json',
    '--dangerously-skip-permissions',
    '--effort',
    effort,
  ]
}

/**
 * Build the env for the spawned `claude -p` process: the OAuth token as
 * `ANTHROPIC_API_KEY`, with the parent env minus any `ANTHROPIC_BASE_URL`
 * that would loop through the balancer.
 */
export function buildClaudeSpawnEnv(
  token: string | undefined,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  delete env['ANTHROPIC_BASE_URL']
  delete env['AI_BALANCER_PRIMARY_PROVIDER']
  if (token !== undefined) {
    env['ANTHROPIC_API_KEY'] = token
  }
  return env
}

/**
 * The HTTP request handler for the claude-code-shim. Exported so tests can
 * drive it without starting a server.
 */
export async function handleClaudeCodeRequest(
  _req: IncomingMessage,
  res: ServerResponse,
  body: OpenAIChatRequest,
  token: string | undefined,
): Promise<void> {
  const model = extractModel(body, DEFAULT_CLAUDE_MODEL)
  const effort = extractEffort(body)
  const prompt = extractPromptFromMessages(body.messages ?? [])
  const stream = extractStream(body)
  const args = buildClaudeArgs(model, effort)
  const env = buildClaudeSpawnEnv(token)

  const result = await spawnCli('claude', args, prompt, { env })

  if (!result.ok) {
    respondError(res, result.status, result.reason)
    return
  }

  const parsed = parseClaudeCodeJson(result.stdout)

  if (parsed === undefined) {
    respondError(res, 502, 'Claude Code CLI produced unparseable output')
    return
  }

  if (parsed.is_error === true) {
    respondError(res, 502, parsed.result ?? 'Claude Code CLI returned an error')
    return
  }

  if (!stream) {
    const response = claudeCodeJsonToChatCompletion(parsed, model)
    respondJson(res, 200, response)
    return
  }

  // Streaming: emit the content as a single chunk (Claude Code's --output-format
  // json returns the whole result at once, so streaming is simulated).
  const id = generateResponseId('chatcmpl-claude')
  const content = parsed.result ?? ''
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
  if (content.length > 0) {
    res.write(
      toSseFrame(
        // oxlint-disable-next-line socket/prefer-undefined-over-null -- OpenAI chat completion streaming wire format requires finish_reason: null on non-final chunks
        buildChatCompletionChunk({ content, finishReason: null, id, model }),
      ),
    )
  }
  res.write(
    toSseFrame(buildChatCompletionChunk({ finishReason: 'stop', id, model })),
  )
  res.write(SSE_DONE)
  res.end()
}

/**
 * Parse `claude doctor` text output into a health status. The text output has
 * no JSON mode, so this scans for key signals: "No installation issues found"
 * means ok; "Not logged in" or "issues found" means missing/degredated.
 */
export function parseClaudeDoctorText(stdout: string): {
  authStatus: 'ok' | 'missing' | 'unknown'
  status: 'ok' | 'degraded'
} {
  const text = stdout.toLowerCase()
  if (text.includes('not logged in') || text.includes('please run /login')) {
    return { authStatus: 'missing', status: 'degraded' }
  }
  if (text.includes('no installation issues found')) {
    return { authStatus: 'ok', status: 'ok' }
  }
  if (text.includes('issues found') || text.includes('error')) {
    return { authStatus: 'unknown', status: 'degraded' }
  }
  return { authStatus: 'unknown', status: 'ok' }
}

/**
 * Probe Claude Code health by running `claude doctor` with `--bare` (to skip
 * settings.json loop). Returns a health object for the `/health` endpoint.
 */
export async function getClaudeHealth(token: string | undefined): Promise<{
  authStatus: 'ok' | 'missing' | 'unknown'
  model: string | undefined
  status: 'ok' | 'degraded'
}> {
  if (token === undefined) {
    return { authStatus: 'missing', model: undefined, status: 'degraded' }
  }
  const env = buildClaudeSpawnEnv(token)
  const result = await spawnCli('claude', ['doctor'], '', {
    env,
    timeoutMs: 10_000,
  })
  if (!result.ok) {
    return { authStatus: 'unknown', model: undefined, status: 'degraded' }
  }
  const { authStatus, status } = parseClaudeDoctorText(result.stdout)
  return { authStatus, model: undefined, status }
}

/**
 * Create the claude-code-shim HTTP server.
 */
export function createClaudeCodeShimServer(token: string | undefined): Server {
  return createLoopbackServer(async (req, res) => {
    const url = req.url ?? '/'
    if (url === '/health') {
      const health = await getClaudeHealth(token)
      handleHealthRequest(res, health)
      return
    }
    if (url === '/v1/models') {
      handleModelsRequest(res, CLAUDE_MODELS)
      return
    }
    if (url === '/v1/chat/completions' && req.method === 'POST') {
      const body = await readJsonBody(req)
      if (body === null || body === undefined) {
        respondError(res, 400, 'Missing request body')
        return
      }
      await handleClaudeCodeRequest(req, res, body as OpenAIChatRequest, token)
      return
    }
    respondError(res, 404, 'Not found')
  })
}

/**
 * Main entry point: read the OAuth token, start the shim on the given port.
 */
export async function main(): Promise<void> {
  const port = parsePortArg(process.argv, DEFAULT_CLAUDE_SHIM_PORT)
  const token = await readClaudeOauthToken()
  if (token === undefined) {
    process.stderr.write(
      'claude-code-shim: could not read OAuth token from keychain\n',
    )
    process.exitCode = 1
    return
  }
  const server = createClaudeCodeShimServer(token)
  await startServer(server, port)
  process.stdout.write(`claude-code-shim listening on 127.0.0.1:${port}\n`)
  const shutdown = () => {
    void stopServer(server).then(() => process.exit(0))
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'serves an OpenAI chat-completions API on loopback, backed by the Claude Code CLI',
  help: `Usage: node scripts/fleet/ai-shims/claude-code-shim.mts [flags]
  --port <n>   listen port (default ${DEFAULT_CLAUDE_SHIM_PORT})`,
}

/* c8 ignore start - entrypoint guard */
if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
/* c8 ignore stop */
