/*
 * @file The fleet's model catalog per offload provider, and the stored
 *   selection read over it. Split out of model-choices.mts so a consumer that
 *   only needs to know WHICH model a seat runs does not pull in the code that
 *   asks a provider what it serves: that path reads a credential, which reaches
 *   socket-lib's keychain and from there its spawn, and the statusline renderer
 *   is compiled ahead of time by perry from this graph.
 *
 *   Reads the selection table and nothing else, so this module stays a leaf.
 */

import { GAUGE_PROVIDERS } from './offload-spend.mts'
import { readOffloadModelSelection } from './socket-state.mts'

import type { GaugeProvider } from './offload-spend.mts'

export interface ModelChoice {
  /**
   * The id the provider's CLI takes.
   */
  readonly id: string
  /**
   * What this model is good for, shown beside it in the picker.
   */
  readonly note: string
  /**
   * Whether this model accepts an image. Absent means it does not.
   *
   * Recorded because a request carrying an image reaches a text-only model as
   * `400 This model does not support image inputs`, and the image stays in the
   * conversation, so every following request fails the same way. The
   * ai-balancer reads this to pick a model that can describe the image instead.
   */
  readonly readsImages?: boolean | undefined
}

export interface ProviderCatalog {
  /**
   * The fleet's pick, and what it was picked for.
   */
  readonly defaultId: string
  readonly models: readonly ModelChoice[]
}

/**
 * The reachable models per provider, with the fleet's default first in intent
 * if not in order. Sourced from `opencode models`, so an id here is one that
 * actually resolves rather than one from a vendor's marketing page.
 */
export const MODEL_CATALOG: Readonly<Record<GaugeProvider, ProviderCatalog>> = {
  'fireworks-ai': {
    defaultId: 'fireworks-ai/accounts/fireworks/models/deepseek-v4-flash-0731',
    models: [
      {
        id: 'fireworks-ai/accounts/fireworks/models/deepseek-v4-flash-0731',
        note: 'the default spend: general fleet work on the seat that bills first',
      },
      {
        id: 'fireworks-ai/accounts/fireworks/models/kimi-k2p7-code',
        note: 'code: codemods, refactors, review — and reads images',
        readsImages: true,
      },
      {
        id: 'fireworks-ai/accounts/fireworks/routers/kimi-k2p7-code-fast',
        note: 'the same model on the fast router',
      },
      {
        id: 'fireworks-ai/accounts/fireworks/models/gpt-oss-120b',
        note: 'bulk text: classification, summarising',
      },
      {
        id: 'fireworks-ai/accounts/fireworks/models/deepseek-v4-pro',
        note: 'long context or a hard reasoning pass',
      },
      {
        id: 'fireworks-ai/accounts/fireworks/routers/kimi-k3-fast',
        // The bare models/kimi-k3 id lists in `opencode models` but the seat
        // cannot serve it — a session substituted onto it died at compaction —
        // so the fast router is the form the ladder verifiably runs.
        note: 'reads images, 1M context — the dearest vision seat, so not the assessor',
        readsImages: true,
      },
      {
        id: 'fireworks-ai/accounts/fireworks/models/qwen3p7-plus',
        note: 'reads images, and the cheapest vision seat: the image assessor',
        readsImages: true,
      },
      {
        id: 'fireworks-ai/accounts/fireworks/models/kimi-k2p6',
        note: 'reads images: the previous Kimi generation, same price as k2.7',
        readsImages: true,
      },
    ],
  },
  // Codex runs the model its own config names; there is no per-call override,
  // so the catalog carries the one entry and the picker reads as fixed.
  // The codex-shim on :8081 wraps `codex exec` behind the OpenAI-compatible API,
  // so the balancer routes to `openai` as a loopback HTTP upstream.
  openai: {
    defaultId: 'gpt-5.6-terra',
    models: [
      { id: 'gpt-5.6-terra', note: 'whatever ~/.codex/config.toml names' },
    ],
  },
  synthetic: {
    defaultId: 'synthetic/hf:openai/gpt-oss-120b',
    models: [
      {
        id: 'synthetic/hf:openai/gpt-oss-120b',
        note: 'bulk text, cheapest per request',
      },
      {
        id: 'synthetic/hf:moonshotai/Kimi-K3',
        note: 'reads images: the large vision seat, and an independent second opinion',
        readsImages: true,
      },
      {
        id: 'synthetic/hf:zai-org/GLM-5.2',
        note: 'alternative general model',
      },
      // PINNED IDS, NOT `syn:` ALIASES. Synthetic documents the aliases as always
      // routing to the current recommended model, but these ids go through
      // OpenCode and `opencode models synthetic` serves neither - both answer
      // `Model not found`. An alias here is an id that cannot run. They stay in
      // model-pricing.json, documenting the mapping without being asked to route:
      // small is hf:Qwen/Qwen3.6-27B, large is hf:moonshotai/Kimi-K3.
      //
      // Context length is not the axis for picking between them, and
      // `small`/`large` name the model rather than the window. The balancer sends
      // one image per call, so neither limit binds; what decides a dense monospace
      // screenshot is encoder fidelity, which
      // `ai-balancer/measure-vision-fidelity.mts` exists to measure.
      {
        id: 'synthetic/hf:Qwen/Qwen3.6-27B',
        note: 'reads images: the small vision seat, personal seat',
        readsImages: true,
      },
    ],
  },
}

export function selectedModel(
  provider: GaugeProvider,
  selection: Readonly<Record<string, string>> = readModelSelection(),
): string {
  const chosen = selection[provider]
  return chosen ? chosen : MODEL_CATALOG[provider].defaultId
}

/**
 * Read the stored selection. An absent or malformed file is an empty selection,
 * which means every provider runs its default.
 *
 * The stored id is TRUSTED, not re-validated. Validation happens once at write,
 * where the provider's live model list is in hand; re-checking here would need
 * that list on every read - a network call on the agent's hot path - and
 * without it every id outside the small hardcoded catalog would be silently
 * discarded, which is exactly how a stored choice appeared to do nothing.
 */
export function readModelSelection(): Record<string, string> {
  const stored = readOffloadModelSelection()
  const out: Record<string, string> = {}
  // Only the known providers pass through, so a stale row for a provider the
  // fleet no longer routes to cannot reach a caller.
  for (const provider of GAUGE_PROVIDERS) {
    const value = stored[provider]
    if (typeof value === 'string' && value.length > 0) {
      out[provider] = value
    }
  }
  return out
}
