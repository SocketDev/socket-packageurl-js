#!/usr/bin/env node
/**
 * @file Translate an OpenAI chat-completions provider's RESPONSES back into
 *   the Anthropic /v1/messages shapes Claude Code speaks. The balancer
 *   converts requests Anthropic → OpenAI for the offload rungs; without this
 *   half the client receives `chat.completion` JSON (or OpenAI SSE chunks) it
 *   cannot parse, and the turn dies at the client even though the provider
 *   answered. Three conversions live here:
 *   openAIToAnthropicMessage   — a buffered non-streaming completion.
 *   createOpenAISseTranslator  — a Transform stream for chat.completion.chunk
 *   SSE, emitting Anthropic message_start /
 *   content_block_* / message_delta / message_stop.
 *   openAIErrorToAnthropic     — an OpenAI error body re-shaped so the client
 *   surfaces it as an Anthropic api error.
 *   GRACEFUL DEGRADE: a body that is not the expected OpenAI shape passes
 *   through untouched (the caller decides), so a provider quirk never eats a
 *   turn. The `model` field always echoes the REQUESTED Anthropic id, never
 *   the provider's own — Claude Code validates the response model against the
 *   session's seat and rejects ids it does not know.
 */

import { Transform } from 'node:stream'
import { StringDecoder } from 'node:string_decoder'

import { Type } from '@sinclair/typebox'
import type { Static } from '@sinclair/typebox'

/**
 * The OpenAI finish_reason to Anthropic stop_reason map.
 */
const FINISH_REASONS: Readonly<Record<string, string>> = {
  content_filter: 'refusal',
  length: 'max_tokens',
  stop: 'end_turn',
  tool_calls: 'tool_use',
}

const ANTHROPIC_TOOL_USE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/
let toolUseIdFallbackCounter = 0

/**
 * Coerce a provider tool-call id into a `tool_use.id` Anthropic accepts.
 * Providers occasionally emit ids with characters outside `[a-zA-Z0-9_-]`, or
 * none at all when a streaming args-fragment races its id. Anthropic rejects
 * the whole message when one round-trips back in history, so every translated
 * id is normalized here. A valid id passes through untouched to keep the
 * provider echo intact, a bad one is scrubbed, and a missing one gets a
 * synthesized `toolu_offload_N`.
 */
function toAnthropicToolUseId(id: string | undefined): string {
  if (
    typeof id === 'string' &&
    id.length > 0 &&
    ANTHROPIC_TOOL_USE_ID_PATTERN.test(id)
  ) {
    return id
  }
  if (typeof id === 'string' && id.length > 0) {
    const scrubbed = id.replace(/[^a-zA-Z0-9_-]/g, '_')
    if (scrubbed.length > 0) {
      return scrubbed
    }
  }
  toolUseIdFallbackCounter += 1
  return `toolu_offload_${toolUseIdFallbackCounter}`
}

/**
 * TypeBox schema for an OpenAI tool call: a function name + JSON-string
 * arguments, carried under `function`, with an id the client echoes back.
 */
export const OpenAIToolCallSchema = Type.Object(
  {
    function: Type.Object(
      {
        arguments: Type.Optional(Type.String()),
        name: Type.Optional(Type.String()),
      },
      { additionalProperties: true },
    ),
    id: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
)

/**
 * TypeBox schema for an OpenAI assistant message. `content` is the visible
 * text; `reasoning_content` (Fireworks) and `reasoning` (Synthetic) are two
 * field names for the same thinking trace — a provider quirk the balancer
 * unifies. Both are optional; a reasoning model may fill one and leave
 * `content` empty when it runs out of tokens.
 */
export const OpenAIMessageSchema = Type.Object(
  {
    content: Type.Optional(Type.String()),
    reasoning: Type.Optional(Type.String()),
    reasoning_content: Type.Optional(Type.String()),
    tool_calls: Type.Optional(Type.Array(OpenAIToolCallSchema)),
  },
  { additionalProperties: true },
)

/**
 * TypeBox schema for OpenAI usage: prompt → input, completion → output,
 * cached prompt tokens → cache_read.
 */
export const OpenAIUsageSchema = Type.Object(
  {
    completion_tokens: Type.Optional(Type.Integer()),
    prompt_tokens: Type.Optional(Type.Integer()),
    prompt_tokens_details: Type.Optional(
      Type.Object(
        { cached_tokens: Type.Optional(Type.Integer()) },
        { additionalProperties: true },
      ),
    ),
  },
  { additionalProperties: true },
)

/**
 * TypeBox schema for an OpenAI chat.completion response: the top-level
 * shape with `object: "chat.completion"` and a `choices` array. Used by
 * {@link isOpenAICompletion} to guard the translation entry point.
 */
export const OpenAICompletionSchema = Type.Object(
  {
    choices: Type.Array(
      Type.Object(
        {
          finish_reason: Type.Optional(Type.String()),
          message: Type.Optional(OpenAIMessageSchema),
        },
        { additionalProperties: true },
      ),
    ),
    id: Type.Optional(Type.String()),
    object: Type.Literal('chat.completion'),
    usage: Type.Optional(OpenAIUsageSchema),
  },
  { additionalProperties: true },
)

type OpenAIMessage = Static<typeof OpenAIMessageSchema>
type OpenAIUsage = Static<typeof OpenAIUsageSchema>

/**
 * The content blocks of an Anthropic assistant message, built from an OpenAI
 * message: text first, then tool uses. The provider's `reasoning` /
 * `reasoning_content` fields are NOT translated to Anthropic `thinking`
 * blocks: a thinking block requires a valid `signature` from Anthropic's
 * API, and a non-Anthropic provider cannot produce one. An invalid signature
 * causes Claude Code to reject the entire response, so the reasoning trace
 * is dropped rather than surfaced as a broken thinking block.
 */
function messageContentBlocks(message: OpenAIMessage): unknown[] {
  const blocks: unknown[] = []
  const text = message.content
  if (typeof text === 'string' && text.length > 0) {
    blocks.push({ text, type: 'text' })
  }
  for (const call of message.tool_calls ?? []) {
    const name = call.function?.name
    if (typeof call.id !== 'string' || typeof name !== 'string') {
      continue
    }
    // Anthropic tool_use.input is an object; OpenAI arguments is a JSON
    // string. An unparseable fragment degrades to an empty object rather than
    // killing the turn.
    let input: unknown = {}
    try {
      input = JSON.parse(call.function?.arguments ?? '{}')
    } catch {
      input = {}
    }
    blocks.push({
      id: toAnthropicToolUseId(call.id),
      input,
      name,
      type: 'tool_use',
    })
  }
  return blocks
}

/**
 * Anthropic usage from OpenAI usage: prompt → input, completion → output,
 * cached prompt tokens → cache_read.
 */
function usageToAnthropic(
  usage: OpenAIUsage | undefined,
): Record<string, number> {
  const out: Record<string, number> = {
    input_tokens: usage?.prompt_tokens ?? 0,
    output_tokens: usage?.completion_tokens ?? 0,
  }
  const cached = usage?.prompt_tokens_details?.cached_tokens
  if (typeof cached === 'number' && cached > 0) {
    out['cache_read_input_tokens'] = cached
  }
  return out
}

/**
 * Whether a parsed body is an OpenAI chat.completion (versus an Anthropic
 * message already, or anything else the pass-through should keep). Probes the
 * two load-bearing fields (`object` and `choices`) rather than running the
 * full schema validator: the translator tolerates missing optional fields, so
 * a shape check is enough to route; a stricter check would reject provider
 * quirks the pass-through is designed to survive.
 */
export function isOpenAICompletion(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) {
    return false
  }
  const b = body as Record<string, unknown>
  return b['object'] === 'chat.completion' && Array.isArray(b['choices'])
}

/**
 * Convert a buffered OpenAI chat.completion to an Anthropic /v1/messages
 * response. Returns undefined when the body is not a completion, so the
 * caller forwards the original bytes unchanged.
 */
export function openAIToAnthropicMessage(
  completion: unknown,
  requestedModel: string,
): Record<string, unknown> | undefined {
  if (!isOpenAICompletion(completion)) {
    return undefined
  }
  const c = completion as {
    choices: Array<{
      finish_reason?: string | undefined
      message?: OpenAIMessage | undefined
    }>
    id?: string | undefined
    usage?: OpenAIUsage | undefined
  }
  const choice = c.choices[0]
  const finish = choice?.finish_reason ?? 'stop'
  return {
    content: messageContentBlocks(choice?.message ?? {}),
    id: c.id ?? 'msg_offload',
    model: requestedModel,
    role: 'assistant',
    stop_reason: FINISH_REASONS[finish] ?? 'end_turn',
    type: 'message',
    usage: usageToAnthropic(c.usage),
  }
}

/**
 * Whether an error body (from any provider, Anthropic or OpenAI-compatible)
 * looks like a context-limit rejection. Claude Code checks for the literal
 * "prompt is too long" in the Anthropic error message to trigger
 * auto-compaction. OpenAI-compatible providers use different wording
 * ("maximum context length", "context_length_exceeded"), so without this
 * detection the compaction trigger never fires when the balancer routes to a
 * non-Anthropic provider.
 */
export function looksLikeContextLimitError(body: string): boolean {
  const lower = body.toLowerCase()
  return (
    lower.includes('prompt is too long') ||
    lower.includes('context length') ||
    lower.includes('context_length_exceeded') ||
    lower.includes('context limit') ||
    lower.includes('maximum context') ||
    lower.includes('token limit exceeded')
  )
}

/**
 * Convert an OpenAI error body ({error:{message,type,code}}) to the Anthropic
 * error envelope Claude Code surfaces. Returns undefined when the body is not
 * an OpenAI error, so the caller forwards the original bytes.
 *
 * A context-limit error is rewritten to the canonical Anthropic message
 * "prompt is too long: context limit exceeded" so Claude Code's
 * auto-compaction fires regardless of which provider returned the error.
 */
export function openAIErrorToAnthropic(
  body: unknown,
): Record<string, unknown> | undefined {
  if (typeof body !== 'object' || body === null) {
    return undefined
  }
  const err = (body as Record<string, unknown>)['error']
  if (typeof err !== 'object' || err === null) {
    return undefined
  }
  const e = err as Record<string, unknown>
  const message = typeof e['message'] === 'string' ? e['message'] : undefined
  if (message === undefined) {
    return undefined
  }
  const rawBody = JSON.stringify(body)
  if (
    looksLikeContextLimitError(rawBody) ||
    looksLikeContextLimitError(message)
  ) {
    return {
      error: {
        message: 'prompt is too long: context limit exceeded',
        type: 'invalid_request_error',
      },
      type: 'error',
    }
  }
  const code = String(e['code'] ?? e['type'] ?? '').toLowerCase()
  const type = code.includes('not_found')
    ? 'not_found_error'
    : code.includes('rate_limit') || code.includes('quota')
      ? 'rate_limit_error'
      : code.includes('auth') ||
          code.includes('permission') ||
          code.includes('key')
        ? 'authentication_error'
        : code.includes('invalid') || code.includes('bad_request')
          ? 'invalid_request_error'
          : 'api_error'
  return { error: { message, type }, type: 'error' }
}

/**
 * One SSE frame: event name + data payload string.
 */
function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

/**
 * The pure half of the stream translator: decoded text in, completed
 * Anthropic SSE frames out, no streams involved. Kept separate from the
 * Transform adapter so the state machine is drivable synchronously — by the
 * fuzz lane, which feeds it mutated bytes at thousands of execs a second and
 * cannot pay stream-scheduling per exec, and by any caller holding text
 * already.
 */
export interface OpenAISseParser {
  /**
   * Finalize the stream; returns the closing frames (always non-empty).
   */
  end(): string[]
  /**
   * Feed decoded text; returns the frames it completes (maybe none).
   */
  push(text: string): string[]
}

/**
 * Create the parser behind {@link createOpenAISseTranslator}.
 *
 * The state machine: reasoning deltas open a thinking block, content deltas a
 * text block, tool_call deltas sequential tool_use blocks (first sight of an
 * id+name opens, a new id closes the previous). finish_reason closes the open
 * block and is HELD, because the usage chunk trails it under stream_options
 * include_usage and message_delta may be emitted only once — [DONE] (or the
 * stream end) finalizes message_delta + message_stop with the real counts.
 */
export function createOpenAISseParser(requestedModel: string): OpenAISseParser {
  let buffer = ''
  let started = false
  let messageId = 'msg_offload'
  let openBlock:
    | { index: number; kind: 'text' | 'thinking' | 'tool_use' }
    | undefined
  let nextIndex = 0
  let usage: OpenAIUsage | undefined
  let pendingFinish: string | undefined
  let finished = false

  const out: string[] = []
  const takeOut = (): string[] => {
    const frames = out.slice()
    out.length = 0
    return frames
  }
  const closeOpenBlock = (): void => {
    if (openBlock !== undefined) {
      out.push(
        sseFrame('content_block_stop', {
          index: openBlock.index,
          type: 'content_block_stop',
        }),
      )
      openBlock = undefined
    }
  }
  const openBlockOf = (
    kind: 'text' | 'thinking' | 'tool_use',
    tool?: { id: string; name: string } | undefined,
  ): void => {
    closeOpenBlock()
    const index = nextIndex
    nextIndex += 1
    const block =
      kind === 'thinking'
        ? { signature: '', thinking: '', type: 'thinking' }
        : kind === 'tool_use'
          ? {
              id: toAnthropicToolUseId(tool?.id),
              input: {},
              name: tool?.name ?? '',
              type: 'tool_use',
            }
          : { text: '', type: 'text' }
    out.push(
      sseFrame('content_block_start', {
        content_block: block,
        index,
        type: 'content_block_start',
      }),
    )
    openBlock = { index, kind }
  }
  const emitStart = (): void => {
    if (started) {
      return
    }
    started = true
    out.push(
      sseFrame('message_start', {
        message: {
          content: [],
          id: messageId,
          model: requestedModel,
          role: 'assistant',
          type: 'message',
          usage: { input_tokens: 0, output_tokens: 0 },
        },
        type: 'message_start',
      }),
    )
  }
  const emitFinish = (): void => {
    if (finished) {
      return
    }
    finished = true
    closeOpenBlock()
    out.push(
      sseFrame('message_delta', {
        delta: {
          stop_reason: FINISH_REASONS[pendingFinish ?? 'stop'] ?? 'end_turn',
        },
        type: 'message_delta',
        usage: usageToAnthropic(usage),
      }),
    )
    out.push(sseFrame('message_stop', { type: 'message_stop' }))
  }

  const handleChunk = (chunk: Record<string, unknown>): void => {
    if (typeof chunk['id'] === 'string') {
      messageId = chunk['id']
    }
    const chunkUsage = chunk['usage']
    if (typeof chunkUsage === 'object' && chunkUsage !== null) {
      usage = chunkUsage as OpenAIUsage
    }
    const choices = Array.isArray(chunk['choices']) ? chunk['choices'] : []
    for (const rawChoice of choices) {
      if (typeof rawChoice !== 'object' || rawChoice === null) {
        continue
      }
      const choice = rawChoice as Record<string, unknown>
      const delta =
        typeof choice['delta'] === 'object' && choice['delta'] !== null
          ? (choice['delta'] as Record<string, unknown>)
          : {}
      const reasoning = delta['reasoning_content'] ?? delta['reasoning']
      // Reasoning from a non-Anthropic provider has no valid thinking
      // signature. Emitting a thinking block with an empty signature causes
      // Claude Code to reject the response, so the reasoning trace is
      // silently dropped here.
      void reasoning
      const text = delta['content']
      if (typeof text === 'string' && text.length > 0) {
        emitStart()
        if (openBlock?.kind !== 'text') {
          openBlockOf('text')
        }
        out.push(
          sseFrame('content_block_delta', {
            delta: { text, type: 'text_delta' },
            index: openBlock!.index,
            type: 'content_block_delta',
          }),
        )
      }
      const toolCalls = Array.isArray(delta['tool_calls'])
        ? (delta['tool_calls'] as unknown[])
        : []
      for (const rawCall of toolCalls) {
        if (typeof rawCall !== 'object' || rawCall === null) {
          continue
        }
        const call = rawCall as Record<string, unknown>
        const fn =
          typeof call['function'] === 'object' && call['function'] !== null
            ? (call['function'] as Record<string, unknown>)
            : {}
        const id = call['id']
        const name = fn['name']
        // A tool call starts when its id+name arrive; the providers send the
        // calls sequentially, so a new id closes the previous block.
        if (typeof id === 'string' && typeof name === 'string') {
          emitStart()
          openBlockOf('tool_use', { id, name })
        }
        const argsFragment = fn['arguments']
        if (typeof argsFragment === 'string' && argsFragment.length > 0) {
          emitStart()
          if (openBlock?.kind !== 'tool_use') {
            openBlockOf('tool_use', {
              id: toAnthropicToolUseId(typeof id === 'string' ? id : ''),
              name: typeof name === 'string' ? name : '',
            })
          }
          out.push(
            sseFrame('content_block_delta', {
              delta: { partial_json: argsFragment, type: 'input_json_delta' },
              index: openBlock!.index,
              type: 'content_block_delta',
            }),
          )
        }
      }
      const finish = choice['finish_reason']
      if (typeof finish === 'string') {
        // Hold the finish: the usage chunk trails the finish chunk under
        // stream_options include_usage, and message_delta may be emitted only
        // once — [DONE] (or the stream end) finalizes with the real counts.
        emitStart()
        pendingFinish = finish
        closeOpenBlock()
      }
    }
  }

  const drain = (final: boolean): void => {
    for (;;) {
      // Frames separate on a blank line; the blank line's own newline may be
      // CRLF on some providers (and on Windows-built streams), so the
      // separator matches LF and CRLF forms alike.
      const sep = /\r?\n\r?\n/.exec(buffer)
      if (sep === null) {
        break
      }
      const frame = buffer.slice(0, sep.index)
      buffer = buffer.slice(sep.index + sep[0].length)
      const frameLines = frame.split(/\r?\n/)
      for (let i = 0, { length } = frameLines; i < length; i += 1) {
        const line = frameLines[i]!
        if (!line.startsWith('data:')) {
          continue
        }
        const data = line.slice(5).trim()
        if (data === '[DONE]') {
          if (!finished) {
            emitStart()
            emitFinish()
          }
          continue
        }
        try {
          handleChunk(JSON.parse(data) as Record<string, unknown>)
        } catch {
          // An unparseable frame is skipped, not fatal: the stream stays alive
          // and the client still receives a well-formed Anthropic stream.
        }
      }
    }
    if (final && !finished) {
      emitStart()
      emitFinish()
    }
  }

  return {
    end(): string[] {
      drain(true)
      return takeOut()
    },
    push(text: string): string[] {
      buffer += text
      drain(false)
      return takeOut()
    },
  }
}

/**
 * Create the Transform stream converting an OpenAI chat.completion.chunk SSE
 * stream into Anthropic /v1/messages SSE events — the thin stream adapter
 * over {@link createOpenAISseParser}, which carries the whole state machine.
 *
 * Bytes become text through a StringDecoder, NOT per-chunk toString: a
 * multi-byte character split across a TCP boundary (CJK output, emoji,
 * smart quotes) would otherwise decode as two replacement characters.
 */
export function createOpenAISseTranslator(requestedModel: string): Transform {
  const parser = createOpenAISseParser(requestedModel)
  const decoder = new StringDecoder('utf8')
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      const frames = parser.push(decoder.write(chunk))
      for (let i = 0, { length } = frames; i < length; i += 1) {
        this.push(frames[i]!)
      }
      callback()
    },
    flush(callback) {
      const tail = parser.push(decoder.end())
      for (let i = 0, { length } = tail; i < length; i += 1) {
        this.push(tail[i]!)
      }
      const closing = parser.end()
      for (let i = 0, { length } = closing; i < length; i += 1) {
        this.push(closing[i]!)
      }
      callback()
    },
  })
}
