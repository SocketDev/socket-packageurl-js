/**
 * @file The 429/529 failover ladder: when the primary upstream returns a rate
 *   limit or overloaded status, the balancer walks the provider ladder and
 *   retries on the next serving rung. This file holds the pure functions
 *   (no I/O) that build the failover ladder and decide whether a status
 *   triggers a failover. The actual retry handler lives inline in proxy.mts's
 *   request callback because it needs the request/response streams.
 */

import {
  MODEL_EQUIVALENCE,
  modelReadsImages,
  visionEquivalentModel,
} from '../_shared/model-choices.mts'
import {
  LADDER_PROVIDERS,
  PROVIDER_ANTHROPIC,
  PROVIDER_ODAI,
} from '../_shared/offload-spend.mts'
import type { GaugeProvider } from '../_shared/offload-spend.mts'

import type { BalancerUpstream } from './proxy.mts'

/**
 * Whether the primary provider requires OpenAI-format requests. Fireworks and
 * Synthetic are OpenAI-compatible; Anthropic takes Anthropic format as-is.
 */
export function primaryRequiresOpenAI(primary: BalancerUpstream): boolean {
  return primary !== PROVIDER_ANTHROPIC
}

/**
 * Whether an upstream status code should trigger a failover to the next
 * provider in the ladder. 429 (rate limit / quota), 529 (overloaded), and
 * 403 (forbidden / entitlement tied to tier) all mean the provider is up but
 * cannot serve this request under current terms, so a different provider
 * might be able to.
 *
 * AUTH (401): NOT failover triggers — wrong credentials are broken across
 * all providers.
 *
 * BAD REQUESTS (400): NOT failover triggers — treat as client error.
 *
 * SERVER ERRORS (500/502/503): NOT failover triggers — transient, retry via
 * transport layer.
 */
export function shouldFailover(status: number): boolean {
  // Provider can't serve this request under current terms
  if (status === 429 || status === 529) {
    return true
  }
  // Rate limit on tier (HTTP 403 Forbidden)
  if (status === 403) {
    return true
  }
  // Billing/credit limit hit (HTTP 402 Payment Required)
  if (status === 402) {
    return true
  }
  // Treat everything else as unfailoverable
  return false
}

/**
 * The ordered list of providers to try when the primary 429/529s, excluding
 * the primary itself and Anthropic (the floor — it is the last resort, tried
 * only when every offload provider is rate-limited). The order mirrors the
 * model-fallback ladder: the LADDER_PROVIDERS rank, minus the current primary.
 */
export function failoverProviders(
  primary: BalancerUpstream,
): readonly BalancerUpstream[] {
  const out: BalancerUpstream[] = []
  for (let i = 0, { length } = LADDER_PROVIDERS; i < length; i += 1) {
    const provider = LADDER_PROVIDERS[i]! as BalancerUpstream
    if (provider !== primary) {
      out.push(provider)
    }
  }
  return out
}

/**
 * One failover candidate: the provider, the wire model to send it, and
 * whether the body needs image-to-text degradation before sending.
 */
export interface FailoverCandidate {
  readonly degradeImage: boolean
  readonly model: string
  readonly primary: BalancerUpstream
  readonly upstream: { host: string; port: number }
  readonly wireModel: string
}

/**
 * Build the failover ladder for a given Anthropic model + family + image
 * presence. Each candidate is a (provider, wireModel) pair from
 * MODEL_EQUIVALENCE, with image capability matching:
 *
 * - If the request carries an image and the role-equivalent model is text-only,
 *   swap to the vision equivalent (visionEquivalentModel).
 * - If no vision seat exists on that provider, flag degradeImage so the caller
 *   OCRs the image to text before sending.
 * - If the request has no image, the role-equivalent model is used as-is.
 *   Providers that have no model for the role (MODEL_EQUIVALENCE returns
 *   undefined) are skipped.
 */
export function buildFailoverLadder(
  family: string,
  // This positional signature is shared verbatim with proxy.mts's call site
  // and the proxy.test.mts suite; renaming to an options bag is a cross-file
  // signature change outside this fix's file scope.
  // oxlint-disable-next-line socket/no-boolean-trap-param -- see above
  carriesImage: boolean,
  primary: BalancerUpstream,
  upstreams: Readonly<Record<string, { host: string; port: number }>>,
  anthropicModel: string,
  env: NodeJS.ProcessEnv = process.env,
): readonly FailoverCandidate[] {
  const role =
    family === 'fable'
      ? 'leading'
      : family === 'opus'
        ? 'reasoning'
        : family === 'sonnet'
          ? 'code'
          : 'fast'
  const providers = failoverProviders(primary)
  const out: FailoverCandidate[] = []
  for (let i = 0, { length } = providers; i < length; i += 1) {
    const provider = providers[i]!
    // Anthropic is the floor, and the floor is REACHED: it carries the
    // requested model unchanged (no MODEL_EQUIVALENCE hop) and its upstream
    // speaks /v1/messages natively, so the caller forwards intact rather
    // than converting. Skipping it here is what turned "synthetic is rate
    // limited" into "every provider is rate-limited" while the one seat that
    // would have served the turn sat unused.
    if (provider === PROVIDER_ANTHROPIC) {
      const anthropicUpstream = upstreams[provider]
      if (anthropicUpstream !== undefined) {
        out.push({
          degradeImage: false,
          model: anthropicModel,
          primary: provider,
          upstream: anthropicUpstream,
          wireModel: anthropicModel,
        })
      }
      continue
    }
    let model: string | undefined
    if (provider === PROVIDER_ODAI) {
      model = env['ODAI_LLAMA_MODEL'] ?? 'local'
    } else {
      model = MODEL_EQUIVALENCE[role][provider as GaugeProvider]
    }
    if (model === undefined) {
      continue
    }
    let wireModel = model
    let degradeImage = false
    if (carriesImage && !modelReadsImages(model)) {
      const vision =
        provider !== PROVIDER_ODAI
          ? visionEquivalentModel(family, provider as GaugeProvider)
          : undefined
      if (vision !== undefined) {
        wireModel = vision
      } else {
        degradeImage = true
      }
    }
    const upstream = upstreams[provider]
    if (upstream === undefined) {
      continue
    }
    out.push({ degradeImage, model, primary: provider, upstream, wireModel })
  }
  return out
}
