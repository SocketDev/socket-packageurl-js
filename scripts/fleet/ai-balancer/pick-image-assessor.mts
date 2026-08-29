#!/usr/bin/env node
/**
 * @file Pick the model the ai-balancer sends an image to, by evaluating what is
 *   actually available and what it actually costs. Run rather than remembered:
 *   a pinned assessor is a guess that rots, and the two inputs that decide it -
 *   which models read images, and what a token costs on each - both move. THE
 *   RULE. The cheapest model that actually reads images. "Actually reads
 *   images" is the half that constrains it: a cheaper model with no vision does
 *   not do this job at any price, it answers `400 This model does not support
 *   image inputs`, which is the failure the balancer exists to remove. So a
 *   candidate needs `readsImages` before its price is compared. Do NOT infer
 *   that from a model's name: `kimi-k2p7-code` is a code model AND reads
 *   images, so the flag is sourced from the vendor's vision-filtered catalog,
 *   never guessed. A PLAN IS FREE IN DOLLARS ONLY, SO THE PAYER RANKS FIRST.
 *   Synthetic bills a monthly plan whose marginal token cost is zero, but its
 *   binding quota is 500 REQUESTS per rolling 5 hours and that plan is the
 *   operator's own, so a caption there spends a scarce personal resource while
 *   the same caption on the company seat costs a fraction of a cent. Candidates
 *   sort by payer first and by cost within a payer; the two billing shapes are
 *   still compared as shapes rather than as numbers. AN UNPRICED CANDIDATE IS
 *   REPORTED, NEVER RANKED. A vision model absent from model-pricing.json has
 *   no cost to compare. Treating that as free would make the cheapest-looking
 *   model the one nobody has priced yet, which is the exact opposite of the
 *   rule. It sorts last and says so. Usage: node
 *   scripts/fleet/ai-balancer/pick-image-assessor.mts [--json]
 */

import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { isMainModule } from '../_shared/is-main-module.mts'
import { MODEL_CATALOG, modelReadsImages } from '../_shared/model-choices.mts'
import { GAUGE_PROVIDERS, PROVIDER_META } from '../_shared/offload-spend.mts'
import { isJsonRequested, runMain } from '../_shared/run-main.mts'

import type { GaugeProvider, Payer } from '../_shared/offload-spend.mts'
import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

/**
 * How a candidate bills, which decides how it may be compared.
 *
 * `plan` carries no per-token number on purpose: the plan is already paid, so
 * the marginal cost of one caption is zero and inventing a fraction of the
 * monthly fee would be a number nobody is charged.
 */
export type AssessorCost =
  | { readonly kind: 'metered'; readonly inputPerMtok: number }
  | { readonly kind: 'plan' }
  | { readonly kind: 'unpriced' }

export interface AssessorCandidate {
  readonly cost: AssessorCost
  readonly id: string
  readonly payer: Payer
  readonly provider: GaugeProvider
}

/**
 * The model id as its provider's pricing table spells it.
 *
 * The catalog prefixes ids with the routing provider (`fireworks-ai/…`,
 * `synthetic/…`) because that is what the CLI takes; the pricing tables are
 * per-service already, so the prefix is not part of the key there.
 */
export function pricingKeyFor(modelId: string): string {
  const slash = modelId.indexOf('/')
  return slash === -1 ? modelId : modelId.slice(slash + 1)
}

/**
 * The pricing service name for a gauge provider. The pricing file is keyed by
 * service rather than by routing prefix, so the two names are mapped here in
 * one place instead of at each read.
 */
export const PRICING_SERVICE_FOR: Readonly<
  Partial<Record<GaugeProvider, string>>
> = {
  'fireworks-ai': 'fireworks',
  synthetic: 'synthetic',
}

interface PricingModelEntry {
  readonly billing?: string | undefined
  readonly inputPerMtok?: number | undefined
}

interface PricingService {
  readonly aliases?: Readonly<Record<string, string>> | undefined
  readonly models?: Readonly<Record<string, PricingModelEntry>> | undefined
}

export interface AssessorPricing {
  readonly services: Readonly<Record<string, PricingService>>
}

/**
 * What one candidate costs per image, read from the pricing table.
 *
 * An alias is resolved through the service's own `aliases` map first, so a
 * `syn:` alias is priced as whatever it currently routes to rather than reading
 * as unpriced.
 */
export function costFor(
  candidate: { readonly id: string; readonly provider: GaugeProvider },
  pricing: AssessorPricing,
): AssessorCost {
  const serviceName = PRICING_SERVICE_FOR[candidate.provider]
  const service = serviceName ? pricing.services[serviceName] : undefined
  if (service === undefined) {
    return { kind: 'unpriced' }
  }
  const key = pricingKeyFor(candidate.id)
  const resolved = service.aliases?.[key] ?? key
  const entry = service.models?.[resolved]
  if (entry === undefined) {
    return { kind: 'unpriced' }
  }
  if (entry.billing === 'plan') {
    return { kind: 'plan' }
  }
  return typeof entry.inputPerMtok === 'number'
    ? { inputPerMtok: entry.inputPerMtok, kind: 'metered' }
    : { kind: 'unpriced' }
}

/**
 * Every catalog model that reads images, with what it costs.
 */
export function imageAssessorCandidates(
  pricing: AssessorPricing,
): AssessorCandidate[] {
  const candidates: AssessorCandidate[] = []
  for (let i = 0, { length } = GAUGE_PROVIDERS; i < length; i += 1) {
    const provider = GAUGE_PROVIDERS[i]!
    const { models } = MODEL_CATALOG[provider]
    for (let m = 0, count = models.length; m < count; m += 1) {
      const { id } = models[m]!
      if (!modelReadsImages(id)) {
        continue
      }
      candidates.push({
        cost: costFor({ id, provider }, pricing),
        id,
        payer: PROVIDER_META[provider].payer,
        provider,
      })
    }
  }
  return candidates
}

/**
 * Cheapest first.
 *
 * A paid plan's marginal caption is free, so `plan` sorts ahead of every
 * metered price. `unpriced` sorts last: it is a missing measurement, and
 * ranking it first would hand the job to whichever model nobody has priced.
 */
/**
 * Where a vendor's own size category sorts on a cost tie: smaller first.
 *
 * Captioning a screenshot is not a job that needs the larger model, and on
 * Synthetic both vision seats bill under the same plan, so cost cannot separate
 * them. A seat naming no category sits between the two rather than ahead of
 * `small`, because an unlabelled model is not a claim to be the smaller one.
 */
export function categoryRank(modelId: string): number {
  if (modelId.includes(':small:')) {
    return 0
  }
  return modelId.includes(':large:') ? 2 : 1
}

/**
 * Where a payer sorts. The company seat first.
 *
 * WHY PAYER OUTRANKS PRICE, given the rule is "cheapest that works". Because a
 * plan is only free in DOLLARS. `PROVIDER_META` records Synthetic's quota as
 * `requests`, 500 per rolling 5 hours, and offload-spend.mts states the reason:
 * on that seat "running out of REQUESTS is what stops work". So a caption there
 * costs 1/500 of the operator's own 5-hour window and competes with their real
 * offload work, while the same caption on the company seat costs a fraction of
 * a cent against a monthly expectation nobody is near. Ranking on dollars alone
 * reads the personal plan as free and spends a scarce personal resource to
 * avoid a sub-penny company charge, which is not the cheaper trade.
 */
export function payerRank(payer: Payer): number {
  return payer === 'company' ? 0 : payer === 'signed-in-account' ? 1 : 2
}

export function rankAssessors(
  candidates: readonly AssessorCandidate[],
): AssessorCandidate[] {
  const rank = (cost: AssessorCost): number =>
    cost.kind === 'plan' ? 0 : cost.kind === 'metered' ? 1 : 2
  return [...candidates].toSorted((left, right) => {
    const byPayer = payerRank(left.payer) - payerRank(right.payer)
    if (byPayer !== 0) {
      return byPayer
    }
    const byKind = rank(left.cost) - rank(right.cost)
    if (byKind !== 0) {
      return byKind
    }
    if (left.cost.kind === 'metered' && right.cost.kind === 'metered') {
      const byPrice = left.cost.inputPerMtok - right.cost.inputPerMtok
      if (byPrice !== 0) {
        return byPrice
      }
    }
    // Two seats that cost the same are separated deliberately, not by id order.
    // Alphabetically `syn:large:vision` precedes `syn:small:vision`, so leaving it
    // to the id would pick the larger model for captioning a screenshot on the
    // grounds of an `l` sorting before an `s`.
    const bySize = categoryRank(left.id) - categoryRank(right.id)
    if (bySize !== 0) {
      return bySize
    }
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  })
}

export interface AssessorChoice {
  readonly candidates: readonly AssessorCandidate[]
  readonly pick: AssessorCandidate | undefined
  /**
   * Why this one, in one sentence, so a reader does not re-derive the ranking.
   */
  readonly why: string
}

export function pickImageAssessor(pricing: AssessorPricing): AssessorChoice {
  const ranked = rankAssessors(imageAssessorCandidates(pricing))
  const pick = ranked[0]
  if (pick === undefined) {
    return {
      candidates: ranked,
      pick: undefined,
      why: 'No catalog model reads images, so an image cannot be assessed at all.',
    }
  }
  const shape =
    pick.cost.kind === 'plan'
      ? 'its plan is already paid, so one more caption is free'
      : pick.cost.kind === 'metered'
        ? `it is the cheapest metered vision seat at $${pick.cost.inputPerMtok}/Mtok input`
        : 'it is the only vision seat available, and nobody has priced it'
  return {
    candidates: ranked,
    pick,
    why: `${pick.id} reads images and ${shape} (payer: ${pick.payer}).`,
  }
}

/**
 * The ranking as lines, cheapest first, with the unpriced ones named as such.
 */
export function formatChoice(choice: AssessorChoice): string {
  const lines = [`Image assessor: ${choice.pick?.id ?? '(none available)'}`, '']
  for (const candidate of choice.candidates) {
    const cost =
      candidate.cost.kind === 'plan'
        ? 'plan (no marginal cost)'
        : candidate.cost.kind === 'metered'
          ? `$${candidate.cost.inputPerMtok}/Mtok in`
          : 'UNPRICED — add it to model-pricing.json'
    lines.push(`  ${candidate.id}`)
    lines.push(`    ${cost} · payer: ${candidate.payer}`)
  }
  lines.push('', choice.why)
  return lines.join('\n')
}

export async function main(): Promise<number> {
  const { loadPricing } = await import('../estimate-ai-cost.mts')
  const pricing = loadPricing() as unknown as AssessorPricing
  const choice = pickImageAssessor(pricing)
  if (isJsonRequested(process.argv)) {
    logger.log(JSON.stringify(choice, undefined, 2))
    return choice.pick === undefined ? 1 : 0
  }
  if (choice.pick === undefined) {
    logger.fail(formatChoice(choice))
    return 1
  }
  logger.log(formatChoice(choice))
  return 0
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'picks the cheapest model that actually reads images, for the ai-balancer image assessor',
  help: `Usage: node scripts/fleet/ai-balancer/pick-image-assessor.mts [flags]

  --json  emit the ranking and the pick as JSON

Ranks every catalog model marked readsImages by what it costs per image: a paid
plan's marginal caption is free and sorts first, metered seats sort by price, and
a vision model absent from model-pricing.json is reported UNPRICED and sorts last
rather than passing as free.`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
