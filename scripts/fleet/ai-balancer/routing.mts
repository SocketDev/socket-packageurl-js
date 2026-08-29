/**
 * @file Model routing and provider credential helpers for the ai-balancer.
 *   Anthropic model ids are mapped to their role-equivalent models on the
 *   primary provider, and provider credentials are attached server-side from
 *   the OS keychain. The 400-retry body builder lives here too, because it
 *   composes routing + image transform: it degrades an image to text.
 */

import type { OutgoingHttpHeaders } from 'node:http'

import { MODEL_EQUIVALENCE } from '../_shared/model-choices.mts'
import type { replaceImageInputs } from './image-inputs.mts'
import {
  PROVIDER_ANTHROPIC,
  PROVIDER_FIREWORKS,
  PROVIDER_ODAI,
  PROVIDER_SYNTHETIC,
} from '../_shared/offload-spend.mts'
import type { GaugeProvider } from '../_shared/offload-spend.mts'
import { readCredential } from '../_shared/provider-credentials.mts'

import { anthropicToOpenAI } from './anthropic-to-openai.mts'
import { primaryRequiresOpenAI } from './failover.mts'
import type { BalancerUpstream } from './proxy.mts'
import { providerWireModelId, transformBodyIfImage } from './proxy.mts'

/**
 * Extract the Anthropic model family from a model id. Fable, Opus, Sonnet, and
 * Haiku are the four families; anything else is not an Anthropic model and is
 * forwarded unchanged.
 */
export function anthropicModelFamily(id: string): string | undefined {
  const families = ['fable', 'opus', 'sonnet', 'haiku']
  const lower = id.toLowerCase()
  for (let i = 0, { length } = families; i < length; i += 1) {
    const family = families[i]!
    if (lower.includes(`claude-${family}`) || lower === family) {
      return family
    }
  }
  return undefined
}

/**
 * Map an Anthropic model id to its equivalent on the primary provider, via
 * MODEL_EQUIVALENCE. Returns the primary's model id, or undefined when the id
 * is not an Anthropic model. The odai seat has no catalog entry: its model is
 * whatever the local llama-server has loaded, named by ODAI_LLAMA_MODEL, and
 * llama-server serves it regardless of the id the request carries.
 */
export function mapToPrimaryModel(
  anthropicId: string,
  primary: BalancerUpstream,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (primary === PROVIDER_ODAI) {
    return env['ODAI_LLAMA_MODEL'] ?? 'local'
  }
  const family = anthropicModelFamily(anthropicId)
  if (family === undefined) {
    return undefined
  }
  const role =
    family === 'fable'
      ? 'leading'
      : family === 'opus'
        ? 'reasoning'
        : family === 'sonnet'
          ? 'code'
          : 'fast'
  return MODEL_EQUIVALENCE[role][primary as GaugeProvider]
}

/**
 * Resolved provider credentials, memoized as their READ PROMISE for the
 * process lifetime. The keychain read behind readCredential can PROMPT on
 * macOS, and the prompt is modal and human-paced: caching the promise (not
 * just the resolved value) means a burst of concurrent requests while the
 * operator is still reading the first prompt shares ONE keychain access
 * instead of stacking a prompt per request. A read that resolves undefined
 * (no key yet, or denied) is evicted, so a key added later is picked up on
 * the next request without a restart.
 */
const credentialReads = new Map<string, Promise<string | undefined>>()

/**
 * The shared read for a provider's credential slot: one in-flight keychain
 * access per provider, however many requests are waiting on it.
 */
function readProviderCredential(
  primary: BalancerUpstream,
  slot: 'fireworksApiKey' | 'syntheticApiKey',
): Promise<string | undefined> {
  let read = credentialReads.get(primary)
  if (read === undefined) {
    read = readCredential(slot).then(
      key => {
        if (key === undefined) {
          credentialReads.delete(primary)
        }
        return key
      },
      err => {
        credentialReads.delete(primary)
        throw err
      },
    )
    credentialReads.set(primary, read)
  }
  return read
}

/**
 * Attach the primary provider's credential server-side, from the keychain or
 * env via the fleet's credential slots. The client's own auth header is
 * REPLACED, not complemented: on an offload rung the client sends its
 * Anthropic auth, which is the wrong credential for the upstream, and the
 * whole point of the server-side attach is that no provider secret has to
 * live in the client's settings file. A rung whose credential does not
 * resolve forwards as-is — the upstream's 401 says the same thing an invented
 * error would, and the statusline's gauge shows the rung dark. odai is
 * keyless: loopback llama-server takes no credential.
 */
export async function attachProviderCredential(
  headers: OutgoingHttpHeaders,
  primary: BalancerUpstream,
): Promise<void> {
  // Drop the client's own credential FIRST, before either branch attaches.
  // The client speaks to the balancer with its Anthropic auth, which is the
  // wrong key for every provider upstream, and forwarding it hands the
  // operator's Anthropic token to a third party. Stripping here rather than
  // per-branch covers all three call sites, the keyless odai rung, and the
  // credential-did-not-resolve fallback below. The Anthropic floor never
  // reaches this function: its call site is guarded by `!toAnthropicFloor`,
  // because there the client's own auth IS the right credential.
  delete headers['authorization']
  delete headers['x-api-key']
  if (primary === PROVIDER_FIREWORKS) {
    const key = await readProviderCredential(primary, 'fireworksApiKey')
    if (key !== undefined) {
      headers['x-fireworks-api-key'] = key
    }
    return
  }
  if (primary === PROVIDER_SYNTHETIC) {
    const key = await readProviderCredential(primary, 'syntheticApiKey')
    if (key !== undefined) {
      headers['authorization'] = `Bearer ${key}`
    }
  }
}

/**
 * Whether an upstream error body looks like an image-inputs rejection.
 *
 * The 400-retry backstop fires only on this shape, so a 400 for any other
 * reason (a bad model id, a malformed request) surfaces untouched rather than
 * being masked by a retry that cannot help.
 */
export function looksLikeImageError(errorBody: string): boolean {
  const lower = errorBody.toLowerCase()
  return (
    lower.includes('image') &&
    (lower.includes('does not support') ||
      lower.includes('unsupported') ||
      lower.includes('not supported'))
  )
}

/**
 * Build the body for a 400-retry: the image degraded to text (an OCR
 * assessment, or a placeholder when the assessor itself fails), converted to
 * the primary's wire format, so the same model that just 400'd on the image
 * receives text it can answer. The retry targets the role-equivalent
 * `MODEL_EQUIVALENCE` model (the text-only default), which is guaranteed to
 * accept a text body.
 *
 * Returns undefined when the body cannot be rebuilt, in which case the caller
 * surfaces the original 400 untouched rather than masking it.
 */
export async function buildImageRetryBody(
  parsed: Record<string, unknown>,
  model: string | undefined,
  primary: BalancerUpstream,
  assess: Parameters<typeof replaceImageInputs>[1],
): Promise<Buffer | undefined> {
  const result = await transformBodyIfImage(
    Buffer.from(JSON.stringify(parsed)),
    assess,
  )
  if (
    primary !== PROVIDER_ANTHROPIC &&
    primaryRequiresOpenAI(primary) &&
    model
  ) {
    const primaryModel = mapToPrimaryModel(model, primary)
    if (primaryModel) {
      let substituted: Record<string, unknown>
      try {
        substituted = JSON.parse(result.body.toString('utf8'))
      } catch {
        return undefined
      }
      return Buffer.from(
        JSON.stringify(
          anthropicToOpenAI(
            substituted,
            providerWireModelId(primaryModel, primary),
          ),
        ),
      )
    }
  }
  return result.body
}
