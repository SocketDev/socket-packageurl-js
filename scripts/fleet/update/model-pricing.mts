/*
 * @file Weekly model-pricing reconcile runner. Prices move often, and the two
 *   surfaces that care fail at different moments: the staleness check
 *   (`pricing-data-is-current.mts`) fires on a date, while
 *   `priced-models-cover-observed-usage.mts` fires the first time a request is
 *   billed on an id carrying no rate. The second is the expensive surprise - it
 *   reds a gate on work that has nothing to do with pricing, which is how
 *   `kimi-fast-latest` reached the release tier.
 *
 *   This runner pulls both failures forward into the weekly wave. It owns
 *   NEITHER definition: staleness comes from the check's own `staleServices()`
 *   and its per-service windows, and the unpriced set comes from the coverage
 *   check's own `measureModelCoverage()`. A second definition of "stale" here
 *   would drift from the gate, and the runner would report current while the
 *   gate reported stale.
 *
 *   What it adds is resolution: a sibling FireConnect checkout states each alias
 *   beside its rate (`fable -> kimi-fast-latest  $4.5 / $22.5 - vision`), so an
 *   id that gate can only report becomes a concrete proposal here.
 *
 *   It never invents a number. An id no source states is REPORTED, because a
 *   fabricated rate mis-costs every request through it while reading as
 *   measured. A router is exempt by class: it manages models rather than being
 *   one, so the cost lands on whichever model answered.
 *
 *   Writing goes through `update-model-pricing.mts`, the single owner of that
 *   file, so this never becomes a second mutator that can disagree about shape
 *   or snapshot stamping.
 *
 *   Modes:
 *     node scripts/fleet/update/model-pricing.mts
 *       Dry plan (default): print stale services, unpriced observed ids, and
 *       the proposals it could apply. Touches nothing.
 *     node scripts/fleet/update/model-pricing.mts --apply
 *       Hand the resolved proposals to the pricing writer.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  measureModelCoverage,
  OBSERVED_WINDOW_DAYS,
} from '../check/priced-models-cover-observed-usage.mts'
import { staleServices } from '../check/pricing-data-is-current.mts'
import { loadPricing } from '../estimate-ai-cost.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import { REPO_ROOT } from '../paths.mts'

import type { StaleService } from '../check/pricing-data-is-current.mts'
import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

/**
 * Sibling checkouts whose own docs state fleet-used aliases and rates. A local
 * source beats a scrape: versioned, diffable, offline. Resolved against the
 * repo root's PARENT, the fleet's sibling layout.
 */
export const LOCAL_RATE_SOURCES: readonly string[] = ['fireconnect/README.md']

/**
 * One alias rate as stated by a local source.
 */
export interface AliasRate {
  readonly alias: string
  readonly inputPerMtok: number
  readonly outputPerMtok: number
  readonly readsImages: boolean
}

// `slot -> alias  $in / $out - vision`, the shape a mapping table prints per
// harness slot. The trailing marker reads `vision` or `text-only`.
const RATE_LINE_RE =
  /->\s*([a-z0-9][\w.-]*)\s+\$([\d.]+)\s*\/\s*\$([\d.]+)[^\n]*/gi

/**
 * Every alias rate a source states, keyed by alias. Pure: takes the text.
 */
export function parseAliasRates(text: string): Map<string, AliasRate> {
  const out = new Map<string, AliasRate>()
  for (const match of text.matchAll(RATE_LINE_RE)) {
    const inputPerMtok = Number(match[2])
    const outputPerMtok = Number(match[3])
    if (!Number.isFinite(inputPerMtok) || !Number.isFinite(outputPerMtok)) {
      continue
    }
    const alias = match[1]!
    out.set(alias, {
      alias,
      inputPerMtok,
      outputPerMtok,
      readsImages: /\bvision\b/i.test(match[0]),
    })
  }
  return out
}

export interface PricingPlan {
  readonly proposals: readonly AliasRate[]
  readonly stale: readonly StaleService[]
  readonly unresolved: readonly string[]
}

/**
 * What the weekly wave should do about pricing. Pure, so tests drive every
 * branch with literals and no filesystem.
 *
 * `observedUnpriced` is the id set the coverage gate would fail on, and `stale`
 * is what the freshness gate would fail on - both computed by those checks, not
 * re-derived here. An id a local source states becomes a proposal; the rest are
 * reported, never guessed.
 */
export function planPricingUpdate(config: {
  readonly observedUnpriced: readonly string[]
  readonly rates: ReadonlyMap<string, AliasRate>
  readonly stale: readonly StaleService[]
}): PricingPlan {
  const { observedUnpriced, rates, stale } = {
    __proto__: null,
    ...config,
  } as typeof config
  const proposals: AliasRate[] = []
  const unresolved: string[] = []
  for (let i = 0, { length } = observedUnpriced; i < length; i += 1) {
    const id = observedUnpriced[i]!
    const rate = rates.get(id)
    if (rate) {
      proposals.push(rate)
    } else {
      unresolved.push(id)
    }
  }
  return { proposals, stale, unresolved }
}

/**
 * The alias rates every configured local source states, merged. An absent
 * source contributes nothing rather than failing: the sibling layout is a
 * convention, not a guarantee, and CI has no siblings at all.
 */
export function readLocalRates(
  options?: { root?: string | undefined } | undefined,
): Map<string, AliasRate> {
  const { root = REPO_ROOT } = { __proto__: null, ...options } as {
    root?: string | undefined
  }
  const merged = new Map<string, AliasRate>()
  const siblings = path.dirname(root)
  for (let i = 0, { length } = LOCAL_RATE_SOURCES; i < length; i += 1) {
    const abs = path.join(siblings, LOCAL_RATE_SOURCES[i]!)
    if (!existsSync(abs)) {
      continue
    }
    let text: string
    try {
      text = readFileSync(abs, 'utf8')
    } catch {
      continue
    }
    for (const [alias, rate] of parseAliasRates(text)) {
      merged.set(alias, rate)
    }
  }
  return merged
}

/**
 * Render the plan. Returns the exit code: anything unresolved is a finding,
 * since only a human can price an id no source states.
 */
export function reportPlan(plan: PricingPlan): number {
  for (const service of plan.stale) {
    logger.warn(
      `${service.service}: snapshot ${service.snapshot} is ${service.age}d old, past its ${service.window}d window`,
    )
  }
  if (plan.proposals.length) {
    logger.log(`${plan.proposals.length} alias rate(s) resolved locally:`)
    logger.group()
    for (const proposal of plan.proposals) {
      const vision = proposal.readsImages ? ' (vision)' : ''
      logger.log(
        `${proposal.alias}: in ${proposal.inputPerMtok} / out ${proposal.outputPerMtok}${vision}`,
      )
    }
    logger.groupEnd()
  }
  if (plan.unresolved.length) {
    logger.fail(
      `${plan.unresolved.length} billed id(s) carry no rate and no local source states one.`,
    )
    logger.group()
    for (const id of plan.unresolved) {
      logger.error(id)
    }
    logger.groupEnd()
    logger.error(
      'Fix: price each id with `node scripts/fleet/update-model-pricing.mts --service <id>`, or exempt a ROUTER in priced-models-cover-observed-usage.mts.',
    )
    return 1
  }
  if (!plan.proposals.length && !plan.stale.length) {
    logger.log('model pricing is current')
  }
  return 0
}

export const SCRIPT_META: ScriptMeta = {
  describe:
    'reconciles model pricing weekly: reports stale snapshots and unpriced billed ids, resolving aliases from local sources',
  help: `Usage: node scripts/fleet/update/model-pricing.mts [--apply]

  (no mode flag)  dry plan: print stale snapshots, unpriced billed ids, and the
                  alias rates it could apply, touching nothing
  --apply         hand the resolved alias rates to update-model-pricing.mts`,
}

/**
 * Measure both gates and plan against what they actually report.
 *
 * `now` and `transcriptRoot` are injectable so a test can drive a real red -
 * the reason this runner shipped green on empty inputs was that nothing could
 * observe it at a clock or a corpus of its own choosing. A real run takes both
 * defaults.
 */
export async function planFromRepo(
  options?:
    | { now?: Date | undefined; transcriptRoot?: string | undefined }
    | undefined,
): Promise<PricingPlan> {
  const { now = new Date(), transcriptRoot } = {
    __proto__: null,
    ...options,
  } as NonNullable<typeof options>
  const pricing = loadPricing()
  const coverage = await measureModelCoverage({
    now: now.getTime(),
    pricing,
    transcriptRoot,
    windowDays: OBSERVED_WINDOW_DAYS,
  })
  // A skipped measure found no transcripts to read. Reporting an empty gap set
  // as "nothing unpriced" would be a false green, so say which it was.
  if (coverage.skipped) {
    logger.warn(
      `observed-usage measure skipped (${coverage.skipped}); the unpriced set is unknown, not empty.`,
    )
  }
  return planPricingUpdate({
    observedUnpriced: coverage.gaps.map(gap => gap.model),
    rates: readLocalRates(),
    stale: staleServices(pricing, now),
  })
}

/* c8 ignore start - entrypoint glue; the pure planner carries the coverage */
export async function main(argv: readonly string[]): Promise<number> {
  const plan = await planFromRepo()
  const code = reportPlan(plan)
  if (argv.includes('--apply') && plan.proposals.length) {
    logger.log(
      'apply: hand these to `update-model-pricing.mts --service <id>`; this runner never writes the file itself.',
    )
  }
  return code
}

if (isMainModule(import.meta.url)) {
  runMain(() => main(process.argv.slice(2)), SCRIPT_META)
}
/* c8 ignore stop */
