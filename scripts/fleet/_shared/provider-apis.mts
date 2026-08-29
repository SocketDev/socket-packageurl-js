/*
 * @file The OpenAI-compatible endpoint each offload provider exposes, and
 *   whether a provider's model can be chosen at all. Split out of
 *   provider-models.mts so a consumer that only needs to ASK about a provider
 *   does not pull in the code that authenticates to one: that module reads a
 *   credential, which reaches socket-lib's keychain, which spawns, and the
 *   statusline renderer is compiled ahead of time by perry from this graph.
 *
 *   `CredentialName` is imported as a type only, so naming a credential here
 *   costs nothing at runtime and this module stays a leaf.
 */

import type { GaugeProvider } from './offload-spend.mts'
import type { CredentialName } from './provider-credentials.mts'

export interface ProviderApi {
  /**
   * The OpenAI-compatible base, without a trailing slash.
   */
  readonly baseUrl: string
  /**
   * Which credential authenticates it.
   */
  readonly credential: CredentialName
  /**
   * The prefix OpenCode addresses this provider's models by. The `/models`
   * endpoint returns bare ids, and a bare id is not what `opencode run -m`
   * takes, so it is restored here rather than at each call site.
   */
  readonly opencodePrefix: string
}

export const PROVIDER_APIS: Readonly<
  Partial<Record<GaugeProvider, ProviderApi>>
> = {
  'fireworks-ai': {
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    credential: 'fireworksApiKey',
    opencodePrefix: 'fireworks-ai/',
  },
  synthetic: {
    baseUrl: 'https://api.synthetic.new/openai/v1',
    credential: 'syntheticApiKey',
    opencodePrefix: 'synthetic/',
  },
}

/**
 * Whether a provider's model can be chosen at all.
 *
 * False for Codex, which runs the model its own config names and takes no
 * per-call override. Storing a selection for it would write a preference
 * nothing reads - `modelForRoute` resolves only the two OpenCode prefixes - so
 * the picker and the cycling caret both have to stop here rather than report a
 * change that did not happen.
 */
export function providerModelIsSelectable(provider: GaugeProvider): boolean {
  return PROVIDER_APIS[provider] !== undefined
}
