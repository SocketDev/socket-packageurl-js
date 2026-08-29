/**
 * @file Translate an Anthropic /v1/messages REQUEST into the OpenAI
 *   /v1/chat/completions shape the offload providers speak. The response-side
 *   twin lives in `openai-to-anthropic.mts`; this file owns the request-side
 *   conversion. The full Claude Code surface is carried: text, base64 images,
 *   thinking blocks, tool_use/tool_result, tools, tool_choice, system
 *   prompts, and streaming options. Provider-quirk fields (cache_control et al)
 *   are stripped rather than forwarded.
 */

/**
 * Flatten an Anthropic tool_result content (a string, or blocks of text and
 * other media) to the plain string an OpenAI tool message carries.
 */
export function flattenToolResultContent(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }
  if (!Array.isArray(content)) {
    return ''
  }
  const texts: string[] = []
  for (const block of content) {
    if (typeof block !== 'object' || block === null) {
      continue
    }
    const b = block as Record<string, unknown>
    if (b['type'] === 'text' && typeof b['text'] === 'string') {
      texts.push(b['text'])
    }
  }
  return texts.join('\n')
}

/**
 * Convert an Anthropic /v1/messages request body to OpenAI /v1/chat/completions
 * format. The model is already mapped to the primary's equivalent by the
 * caller. The full Claude Code surface is carried, because a routed session
 * lives and dies by it: text passes through, base64 images become image_url
 * data URIs, thinking blocks become reasoning_content, tool_use blocks become
 * tool_calls, tool_result blocks become role:tool messages, the tools and
 * tool_choice fields map onto their OpenAI function shapes, and a system
 * field — string or block array — becomes a system-role message. Provider
 * quirks are stripped rather than forwarded: cache_control and other
 * Anthropic-only fields never reach the OpenAI wire. A streaming request asks
 * for the trailing usage chunk (stream_options include_usage), which the
 * response translator folds into message_delta.
 */
export function anthropicToOpenAI(
  anthropic: Record<string, unknown>,
  openaiModel: string,
): Record<string, unknown> {
  const messages: unknown[] = []

  // Anthropic's `system` becomes OpenAI's system-role message, joining block
  // arrays to one string.
  const system = anthropic['system']
  if (typeof system === 'string') {
    messages.push({ content: system, role: 'system' })
  } else if (Array.isArray(system)) {
    const texts: string[] = []
    for (const block of system) {
      if (typeof block !== 'object' || block === null) {
        continue
      }
      const b = block as Record<string, unknown>
      if (b['type'] === 'text' && typeof b['text'] === 'string') {
        texts.push(b['text'])
      }
    }
    if (texts.length > 0) {
      messages.push({ content: texts.join('\n\n'), role: 'system' })
    }
  }

  // Convert each Anthropic message.
  const anthropicMessages = Array.isArray(anthropic['messages'])
    ? anthropic['messages']
    : []
  for (const msg of anthropicMessages) {
    if (typeof msg !== 'object' || msg === null) {
      continue
    }
    const msgObj = msg as Record<string, unknown>
    const role = typeof msgObj['role'] === 'string' ? msgObj['role'] : 'user'
    const content = msgObj['content']

    if (typeof content === 'string') {
      messages.push({ content, role })
      continue
    }

    if (Array.isArray(content)) {
      const parts: unknown[] = []
      const toolCalls: unknown[] = []
      const toolResults: unknown[] = []
      let reasoning = ''
      for (const block of content) {
        if (typeof block !== 'object' || block === null) {
          continue
        }
        const b = block as Record<string, unknown>
        if (b['type'] === 'text' && typeof b['text'] === 'string') {
          parts.push({ text: b['text'], type: 'text' })
        } else if (
          b['type'] === 'thinking' &&
          typeof b['thinking'] === 'string'
        ) {
          reasoning += (reasoning.length > 0 ? '\n' : '') + b['thinking']
        } else if (
          b['type'] === 'tool_use' &&
          typeof b['id'] === 'string' &&
          typeof b['name'] === 'string'
        ) {
          toolCalls.push({
            function: {
              arguments: JSON.stringify(b['input'] ?? {}),
              name: b['name'],
            },
            id: b['id'],
            type: 'function',
          })
        } else if (
          b['type'] === 'tool_result' &&
          typeof b['tool_use_id'] === 'string'
        ) {
          toolResults.push({
            content: flattenToolResultContent(b['content']),
            role: 'tool',
            tool_call_id: b['tool_use_id'],
          })
        } else if (
          b['type'] === 'image' &&
          typeof b['source'] === 'object' &&
          b['source'] !== null
        ) {
          const src = b['source'] as Record<string, unknown>
          if (
            src['type'] === 'base64' &&
            typeof src['data'] === 'string' &&
            typeof src['media_type'] === 'string'
          ) {
            parts.push({
              image_url: {
                url: `data:${src['media_type']};base64,${src['data']}`,
              },
              type: 'image_url',
            })
          }
        }
      }
      // Tool results ride their own messages, and OpenAI wants them right
      // after the assistant turn that called the tools — emit them first.
      messages.push(...toolResults)
      if (role === 'assistant') {
        const text = parts
          .filter(
            p =>
              typeof p === 'object' &&
              p !== null &&
              (p as Record<string, unknown>)['type'] === 'text',
          )
          .map(p => (p as Record<string, unknown>)['text'] as string)
          .join('\n')
        const assistant: Record<string, unknown> = {
          // oxlint-disable-next-line socket/prefer-undefined-over-null -- the OpenAI wire marks a tool-calling assistant turn with a null content, not a missing one.
          content: text.length > 0 ? text : null,
          role: 'assistant',
        }
        if (reasoning.length > 0) {
          assistant['reasoning_content'] = reasoning
        }
        if (toolCalls.length > 0) {
          assistant['tool_calls'] = toolCalls
        }
        // An empty assistant turn (no text, no calls) carries nothing.
        if (text.length > 0 || toolCalls.length > 0) {
          messages.push(assistant)
        }
      } else if (parts.length > 0) {
        messages.push({ content: parts, role })
      }
      continue
    }

    // Unknown content shape — pass through as-is.
    messages.push({ content, role })
  }

  const out: Record<string, unknown> = {
    max_tokens: anthropic['max_tokens'],
    messages,
    model: openaiModel,
    stream: anthropic['stream'] ?? false,
  }
  // Tools map onto OpenAI's function shape; tool_choice follows.
  if (Array.isArray(anthropic['tools'])) {
    const tools: unknown[] = []
    for (const tool of anthropic['tools']) {
      if (typeof tool !== 'object' || tool === null) {
        continue
      }
      const t = tool as Record<string, unknown>
      if (typeof t['name'] !== 'string') {
        continue
      }
      tools.push({
        function: {
          description:
            typeof t['description'] === 'string' ? t['description'] : '',
          name: t['name'],
          parameters: t['input_schema'] ?? { type: 'object' },
        },
        type: 'function',
      })
    }
    if (tools.length > 0) {
      out['tools'] = tools
    }
  }
  const toolChoice = anthropic['tool_choice']
  if (typeof toolChoice === 'object' && toolChoice !== null) {
    const tc = toolChoice as Record<string, unknown>
    if (tc['type'] === 'auto') {
      out['tool_choice'] = 'auto'
    } else if (tc['type'] === 'any') {
      out['tool_choice'] = 'required'
    } else if (tc['type'] === 'none') {
      out['tool_choice'] = 'none'
    } else if (tc['type'] === 'tool' && typeof tc['name'] === 'string') {
      out['tool_choice'] = {
        function: { name: tc['name'] },
        type: 'function',
      }
    }
  }
  if (Array.isArray(anthropic['stop_sequences'])) {
    out['stop'] = anthropic['stop_sequences']
  }
  if (typeof anthropic['temperature'] === 'number') {
    out['temperature'] = anthropic['temperature']
  }
  if (typeof anthropic['top_p'] === 'number') {
    out['top_p'] = anthropic['top_p']
  }
  if (anthropic['stream'] === true) {
    // The trailing usage chunk feeds message_delta's token counts.
    out['stream_options'] = { include_usage: true }
  }
  return out
}
