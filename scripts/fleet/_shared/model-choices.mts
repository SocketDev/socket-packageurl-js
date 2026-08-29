/**
 * @file Which model each offload provider may run, which one the fleet picked,
 *   and which one is actually selected right now.
 *   WHY A CATALOG RATHER THAN ONE PINNED MODEL. A provider serves a dozen
 *   models and the best one for a job changes as they ship. Pinning one in the
 *   routing table means every re-evaluation is a code change; naming a DEFAULT
 *   and letting a selection override it means the fleet's opinion is on the
 *   record and still overridable in one click.
 *   THE DEFAULT IS THE FLEET'S OPINION, NOT A PLACEHOLDER. Each provider's
 *   default is the model measured best for the work routed to it, and the
 *   reason is written beside it. A reader changing it should be able to see
 *   what they are trading away.
 *   THE SELECTION IS A FILE, NOT A UI STATE. A statusline cannot render a
 *   dropdown - OSC 8 is the only interaction a terminal line has - so the
 *   picker lives on the report page, which is served over a real origin. The
 *   page writes here, the offload routing reads here, and neither knows about
 *   the other.
 *   MODELS ARE NOT A FREE FIELD. A selection naming a model that is not in this
 *   catalog is refused, so a typo or a stale bookmark cannot silently point the
 *   fleet's work at nothing, and a jurisdiction-banned endpoint cannot be
 *   selected by editing a file.
 */

import {
  MODEL_CATALOG,
  readModelSelection,
  selectedModel,
} from './model-catalog.mts'
import { cachedModelIds } from './model-list-cache.mts'
import { shortModelName } from './offload-spend.mts'
import { listProviderModels, sortByFamily } from './provider-models.mts'
import { writeOffloadModelSelection } from './socket-state.mts'

import type { GaugeProvider } from './offload-spend.mts'

// Re-exported so existing callers keep naming these from here; they live in a
// leaf module because this one asks providers what they serve.
export {
  MODEL_CATALOG,
  readModelSelection,
  selectedModel,
} from './model-catalog.mts'
export type { ModelChoice, ProviderCatalog } from './model-catalog.mts'

/**
 * The model the ai-balancer sends an image to when the answering model cannot
 * read one.
 *
 * THE RULE IS THE CHEAPEST MODEL THAT ACTUALLY READS IMAGES. The work is
 * captioning a screenshot, which is not a job worth a premium seat. "That
 * actually reads images" is the half that constrains it: a cheaper model with
 * no vision does not do this job at any price, it answers `400 This model does
 * not support image inputs`, which is the failure the balancer exists to
 * remove. That rules out the code models regardless of cost, so a candidate
 * needs `readsImages` before its price is even compared.
 *
 * AMONG VISION SEATS, THE PAYER BREAKS THE TIE. Fireworks is the company
 * account and Synthetic is the operator's own (`PROVIDER_META.payer`), so a
 * Synthetic assessor would put a recurring cost on a personal card for company
 * work. A cheaper personal seat is not cheaper for the fleet, it just moves who
 * pays. Fireworks is also the default spend seat, so an image bills where the
 * rest of the turn already bills.
 *
 * THE SCRIPT IS THE AUTHORITY, THIS IS ITS ANSWER WRITTEN DOWN.
 * `ai-balancer/pick-image-assessor.mts` ranks every vision seat by what it
 * costs and prints the pick; this constant is that pick, so the request path
 * does not shell out per image. A spec asserts the two agree against the real
 * pricing table, so adding a cheaper vision seat fails the suite and names the
 * script to re-run rather than leaving a stale choice nobody notices.
 *
 * Not computed at call time: a lookup that silently moved providers would
 * change whose money it spends without anyone choosing it.
 */
export const IMAGE_ASSESSOR_MODEL =
  'fireworks-ai/accounts/fireworks/models/qwen3p7-plus'

/**
 * The role a model plays in its provider's lineup, used to map across
 * providers. A model's role is what makes it an equivalent: Fable is
 * Anthropic's leading model, and the leading model on Fireworks is its
 * equivalent — not because they are the same model, but because they serve the
 * same position in the hierarchy.
 */
export type ModelRole = 'leading' | 'reasoning' | 'code' | 'fast'

/**
 * The cross-provider model equivalence table, keyed by role. Each row names the
 * model that plays that role on each provider. A provider with one model
 * (OpenAI via Codex) fills every role with it, since there is no finer choice.
 *
 * Fable is the LEADING model from Anthropic — the premier, the opposite of
 * Haiku. Haiku is the lightweight fast one. Opus is the heavy reasoning model.
 * Sonnet is the balanced code model.
 *
 * This is a routing fallback, not a claim of equivalence: a Fireworks model
 * behaves differently from an Anthropic one, but when an Anthropic model cannot
 * be reached the role tells you which model to send the work to instead.
 */
export const MODEL_EQUIVALENCE: Readonly<
  Record<ModelRole, Readonly<Record<GaugeProvider, string>>>
> = {
  code: {
    'fireworks-ai': 'fireworks-ai/accounts/fireworks/models/kimi-k2p7-code',
    openai: 'gpt-5.6-terra',
    synthetic: 'synthetic/hf:moonshotai/Kimi-K3',
  },
  fast: {
    'fireworks-ai':
      'fireworks-ai/accounts/fireworks/models/deepseek-v4-flash-0731',
    openai: 'gpt-5.6-terra',
    synthetic: 'synthetic/hf:openai/gpt-oss-120b',
  },
  leading: {
    'fireworks-ai': 'fireworks-ai/accounts/fireworks/routers/kimi-k3-fast',
    openai: 'gpt-5.6-terra',
    synthetic: 'synthetic/hf:moonshotai/Kimi-K3',
  },
  reasoning: {
    'fireworks-ai': 'fireworks-ai/accounts/fireworks/models/deepseek-v4-pro',
    openai: 'gpt-5.6-terra',
    synthetic: 'synthetic/hf:zai-org/GLM-5.2',
  },
}

/**
 * The cross-provider model equivalence table for IMAGE turns, keyed by role.
 * Each row names a model that plays that role on each provider AND reads
 * images, so a turn carrying an image is routed to a model that can see it
 * rather than 400ing. This is the "comparable vision enabled model" the
 * ai-balancer swaps to when an image is present and the role-equivalent
 * `MODEL_EQUIVALENCE` model is text-only.
 *
 * WHY A SEPARATE TABLE RATHER THAN REUSING MODEL_EQUIVALENCE. The role
 * equivalent is not always a vision seat: Opus -> reasoning ->
 * `deepseek-v4-pro` is text-only, Haiku -> fast -> `deepseek-v4-flash` is
 * text-only. Routing an image to either 400s, which is the failure the
 * balancer exists to remove. The vision table picks a vision-capable model
 * for the same role, tiering up within the provider when the role's default
 * cannot read images (reasoning -> the dearest vision seat `kimi-k3-fast`,
 * since no vision reasoning seat exists on Fireworks).
 *
 * Every Fireworks and Synthetic entry is a `readsImages: true` model in
 * MODEL_CATALOG. A spec asserts that, so a catalog edit pointing a vision role
 * at a text-only model fails the suite. The OpenAI column is carried for shape
 * parity with MODEL_EQUIVALENCE but is never a balancer HTTP primary (Codex
 * runs through its own CLI), so it is exempt from the vision invariant.
 */
export const MODEL_VISION_EQUIVALENCE: Readonly<
  Record<ModelRole, Readonly<Record<GaugeProvider, string>>>
> = {
  code: {
    'fireworks-ai': 'fireworks-ai/accounts/fireworks/models/kimi-k2p7-code',
    openai: 'gpt-5.6-terra',
    // Kimi-K3 serves the code role on Synthetic and already reads images, so
    // the vision table shares the same model for that role.
    synthetic: 'synthetic/hf:moonshotai/Kimi-K3',
  },
  fast: {
    'fireworks-ai': 'fireworks-ai/accounts/fireworks/models/qwen3p7-plus',
    openai: 'gpt-5.6-terra',
    synthetic: 'synthetic/hf:Qwen/Qwen3.6-27B',
  },
  leading: {
    'fireworks-ai': 'fireworks-ai/accounts/fireworks/routers/kimi-k3-fast',
    openai: 'gpt-5.6-terra',
    synthetic: 'synthetic/hf:moonshotai/Kimi-K3',
  },
  reasoning: {
    // No vision reasoning seat on Fireworks: the dearest vision seat serves.
    'fireworks-ai': 'fireworks-ai/accounts/fireworks/routers/kimi-k3-fast',
    openai: 'gpt-5.6-terra',
    synthetic: 'synthetic/hf:moonshotai/Kimi-K3',
  },
}

/**
 * The four Anthropic model families, in canonical order (leading → fast).
 * The single source of truth — other files derive from this rather than
 * re-enumerating.
 */
export const ANTHROPIC_FAMILIES = ['fable', 'opus', 'sonnet', 'haiku'] as const

/**
 * The role an Anthropic model family plays, used to find its cross-provider
 * equivalent. Fable is leading, Opus is reasoning, Sonnet is code, Haiku is
 * fast.
 */
export function roleForAnthropicFamily(family: string): ModelRole | undefined {
  if (family === 'fable') {
    return 'leading'
  }
  if (family === 'opus') {
    return 'reasoning'
  }
  if (family === 'sonnet') {
    return 'code'
  }
  if (family === 'haiku') {
    return 'fast'
  }
  return undefined
}

/**
 * The equivalent model on a target provider for an Anthropic model family, or
 * undefined when the family is unknown. Used by the ai-balancer to route work
 * when the Anthropic model cannot be reached.
 */
export function equivalentModel(
  anthropicFamily: string,
  targetProvider: GaugeProvider,
): string | undefined {
  const role = roleForAnthropicFamily(anthropicFamily)
  if (role === undefined) {
    return undefined
  }
  return MODEL_EQUIVALENCE[role][targetProvider]
}

/**
 * The vision-capable equivalent on a target provider for an Anthropic model
 * family, or undefined when the family is unknown. Used by the ai-balancer to
 * route an image turn to a model that can read it, instead of letting the
 * role-equivalent text-only model 400.
 *
 * Falls back to undefined when no vision seat is recorded for the role on the
 * provider; the caller then degrades to OCR substitution so the turn still
 * lands.
 */
export function visionEquivalentModel(
  anthropicFamily: string,
  targetProvider: GaugeProvider,
): string | undefined {
  const role = roleForAnthropicFamily(anthropicFamily)
  if (role === undefined) {
    return undefined
  }
  return MODEL_VISION_EQUIVALENCE[role][targetProvider]
}

/**
 * The assessor to use when the company seat cannot be reached.
 *
 * The cheapest vision seat available, which is the small Synthetic one. It
 * bills the operator personally, so it is a fallback rather than the default:
 * better a personally-billed caption than a lost turn, and better still the
 * company seat.
 */
export const IMAGE_ASSESSOR_FALLBACK_MODEL = 'synthetic/hf:Qwen/Qwen3.6-27B'

/**
 * Whether a model accepts an image, per the catalog.
 *
 * The catalog is the OFFLINE answer, which is the one the request path needs: a
 * transform deciding whether to substitute an image cannot wait on a round trip
 * to ask. Synthetic's `/openai/v1/models` is the live authority, so a model
 * absent from the catalog reads as text-only here rather than as unknown -
 * substituting an assessment for a model that could have read the image costs a
 * caption, and NOT substituting for one that cannot costs the whole turn.
 */
export function modelReadsImages(modelId: string): boolean {
  const providers = Object.keys(MODEL_CATALOG) as GaugeProvider[]
  for (let i = 0, { length } = providers; i < length; i += 1) {
    const { models } = MODEL_CATALOG[providers[i]!]
    for (let m = 0, count = models.length; m < count; m += 1) {
      const model = models[m]!
      if (model.id === modelId) {
        return model.readsImages === true
      }
    }
  }
  return false
}

/**
 * Whether this model id may be selected for a provider.
 *
 * The catalog is the baseline, and a model the provider CURRENTLY serves counts
 * too: otherwise the live picker would offer a choice that storing it then
 * refuses.
 */
export function isKnownModel(
  provider: GaugeProvider,
  id: string,
  liveIds?: readonly string[] | undefined,
): boolean {
  if (MODEL_CATALOG[provider].models.some(model => model.id === id)) {
    return true
  }
  return liveIds?.includes(id) === true
}

/**
 * The model a provider should run: the stored selection when it names a model
 * the catalog knows, otherwise the fleet's default.
 *
 * An unknown id falls back rather than throwing. The caller is a statusline
 * render or a routed agent, and refusing to run because a preference file went
 * stale would be worse than running the default and showing it.
 */

/**
 * Store a provider's model choice.
 *
 * Refuses an id the catalog does not list, so a typo or a stale bookmark cannot
 * point the fleet's work at a model that does not resolve - or at an endpoint
 * the jurisdiction gate bans.
 */
export function writeModelSelection(
  provider: GaugeProvider,
  id: string,
  liveIds?: readonly string[] | undefined,
): void {
  // The live list counts too. Validating against the catalog ALONE meant the
  // picker offered every model the provider serves and the store then refused
  // most of them - a menu whose entries do not work.
  if (!isKnownModel(provider, id, liveIds)) {
    throw new Error(
      `Unknown model "${id}" for ${provider}. Where: writeModelSelection. Saw an id neither the catalog nor the provider's live list carries; wanted one of ${MODEL_CATALOG[provider].models.map(m => m.id).join(', ')}. Fix: pick a listed model, or add it to MODEL_CATALOG in scripts/fleet/_shared/model-choices.mts.`,
    )
  }
  const selection = { ...readModelSelection(), [provider]: id }
  writeOffloadModelSelection(selection)
}

/**
 * A provider's picker rows: every model, which is selected, and whether it is
 * the fleet's default. The report page renders this; nothing about the shape is
 * HTML, so a CLI picker could render the same rows.
 */
export interface PickerRow {
  readonly id: string
  readonly isDefault: boolean
  readonly label: string
  readonly note: string
  readonly selected: boolean
}

/**
 * The rows for one provider: the UNION of what it serves and what the catalog
 * carries, family-sorted so a step lands on a near neighbour.
 *
 * A live list REPLACING the catalog is what broke the caret. An account whose
 * `/models` answers with a single deployment leaves a one-entry list on disk,
 * `advanceModelTarget` refuses to step a list shorter than two, and the click
 * then did nothing with no console to say why. A union can never be smaller
 * than the catalog, so the cycle cannot shrink below it, and the live list
 * still widens the choices the way it was meant to.
 */
export function pickerRowsFor(
  provider: GaugeProvider,
  selection: Readonly<Record<string, string>> = readModelSelection(),
  liveIds?: readonly string[] | undefined,
): PickerRow[] {
  const catalog = MODEL_CATALOG[provider]
  const current = selectedModel(provider, selection)
  const noteFor = new Map(catalog.models.map(model => [model.id, model.note]))
  // The live list is what the provider will serve today; the catalog is the
  // fleet's own set and the source of the notes. A model the provider serves
  // that the catalog has no opinion about still belongs in the picker, and a
  // catalog model missing from a short or failed live answer still belongs in
  // the cycle.
  const ids = sortByFamily([
    ...new Set([...(liveIds ?? []), ...catalog.models.map(model => model.id)]),
  ])
  return ids.map(id => ({
    id,
    isDefault: id === catalog.defaultId,
    label: shortModelName(id),
    note: noteFor.get(id) ?? '',
    selected: id === current,
  }))
}

/**
 * The picker rows with the provider's live model list folded in.
 *
 * The async twin of {@link pickerRowsFor}: it asks the provider what it serves
 * and falls back to the catalog when there is no key, no network, or a payload
 * shape that changed.
 */
export async function livePickerRowsFor(
  provider: GaugeProvider,
  selection: Readonly<Record<string, string>> = readModelSelection(),
): Promise<PickerRow[]> {
  return pickerRowsFor(provider, selection, await listProviderModels(provider))
}

/**
 * The picker rows WITHOUT asking the provider anything: the last list it
 * served, falling back to the catalog.
 *
 * The synchronous twin of {@link livePickerRowsFor}, and the one the statusline
 * caret uses. Listing models needs the provider's API key, reading that key is
 * an OS auth prompt, and a click is a fresh process launched with a minimal
 * environment - so the live path asked for a password on EVERY click. Stepping
 * to the next model needs an ordered list, not a fresh one, so this reads the
 * cache and touches no credential.
 */
export function cachedPickerRowsFor(
  provider: GaugeProvider,
  selection: Readonly<Record<string, string>> = readModelSelection(),
): PickerRow[] {
  return pickerRowsFor(provider, selection, cachedModelIds(provider))
}

/**
 * The id one step after `current`, wrapping past the end.
 *
 * A `current` the list does not carry answers with the FIRST id rather than
 * undefined. That is the stale-selection case - the provider retired the model
 * since it was stored - and re-entering the list at the top is the only
 * behaviour that leaves the reader somewhere; refusing would strand them on a
 * model that no longer resolves with a caret that appears to do nothing.
 */
export function nextIdAfter(
  current: string,
  ids: readonly string[],
): string | undefined {
  if (ids.length === 0) {
    return undefined
  }
  const at = ids.indexOf(current)
  return at === -1 ? ids[0] : ids[(at + 1) % ids.length]
}

export interface AdvanceModelConfig {
  /**
   * The candidate ids IN THE ORDER THE PICKER SHOWS THEM, so one click lands on
   * the row below the current one. The live list arrives family-sorted from
   * `sortByFamily`, which is what makes a step land on a near neighbour instead
   * of an unrelated vendor. One order for both surfaces: a cycle that ran in a
   * different order than the list on screen would look like it skipped rows.
   */
  readonly ids: readonly string[]
  readonly provider: GaugeProvider
}

/**
 * Move a provider one step down its model list and store the result.
 *
 * Returns the new id, or undefined when there is nothing to move to: an empty
 * list, or a single-model provider where a "change" would write the value
 * already there and report a change that did not happen.
 *
 * The ids come in rather than being fetched here. The caller already holds the
 * live list - it needs it to validate the write - and fetching twice would put
 * a second network call on a path a click is waiting for.
 */
export function advanceModelSelection(
  config: AdvanceModelConfig,
): string | undefined {
  const cfg = { __proto__: null, ...config } as AdvanceModelConfig
  if (cfg.ids.length < 2) {
    return undefined
  }
  const current = selectedModel(cfg.provider, readModelSelection())
  const next = nextIdAfter(current, cfg.ids)
  if (next === undefined || next === current) {
    return undefined
  }
  writeModelSelection(cfg.provider, next, cfg.ids)
  return next
}
