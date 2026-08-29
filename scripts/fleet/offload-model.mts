#!/usr/bin/env node
/**
 * @file `offload-model` — see and change which model each offload provider runs.
 *   THE TERMINAL PATH, BESIDE THE PAGE ONE. The report page has a dropdown, but
 *   a page is a detour when the question is "what is Fireworks set to" and the
 *   answer is one line. Both write the same file and the routed agents read it,
 *   so neither is a second source of truth.
 *   IT LISTS WHAT THE PROVIDER SERVES TODAY. The choices come from the
 *   provider's own `/models` endpoint when a credential resolves, falling back
 *   to the curated catalog. A menu built only from the catalog would hide most
 *   of what is reachable - which is how a request for a live model got refused.
 *   Usage:
 *   pnpm run offload:model                       # show what each runs
 *   pnpm run offload:model --list fireworks-ai   # every model it serves
 *   pnpm run offload:model --next fireworks-ai   # step one down that list
 *   pnpm run offload:model --pick fireworks-ai   # choose from it interactively
 *   pnpm run offload:model --set fireworks-ai --model <id>
 */

import process from 'node:process'

import { parseArgs } from '@socketsecurity/lib-stable/argv/parse'
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { select } from '@socketsecurity/lib-stable/stdio/prompts'

import { isMainModule } from './_shared/is-main-module.mts'
import {
  livePickerRowsFor,
  selectedModel,
  writeModelSelection,
} from './_shared/model-choices.mts'
import {
  readAvailabilityTable,
  servingStateFor,
} from './_shared/provider-availability.mts'
import {
  advanceModelTarget,
  isModelTargetId,
  MODEL_TARGETS,
  readModelTarget,
} from './_shared/model-targets.mts'
import { GAUGE_PROVIDERS, PROVIDER_META } from './_shared/offload-spend.mts'
import {
  listProviderModels,
  providerModelIsSelectable,
} from './_shared/provider-models.mts'
import { renderPickerLines, renderPromptChoices } from './_shared/picker.mts'
import { runMain } from './_shared/run-main.mts'

import type { GaugeProvider } from './_shared/offload-spend.mts'
import type { ScriptMeta } from './_shared/run-main.mts'

const logger = getDefaultLogger()

/**
 * Whether a string names a provider a gauge is drawn for.
 */
export function isGaugeProvider(value: string): value is GaugeProvider {
  return GAUGE_PROVIDERS.includes(value as GaugeProvider)
}

/**
 * One line per provider: what it runs now.
 */
export function summaryLines(): string[] {
  return GAUGE_PROVIDERS.map(provider => {
    const meta = PROVIDER_META[provider]
    return `  ${meta.label.padEnd(6)} ${selectedModel(provider)}`
  })
}

/**
 * Step one provider to the next model it serves.
 *
 * The deterministic executor behind the statusline's caret: the click opens a
 * URL, the URL handler runs THIS, and both surfaces get the same refusals and
 * the same wrap-around. A caret with its own copy of the logic would be a
 * second source of truth for which model is next.
 */
export function advanceProvider(name: string): number {
  if (!isModelTargetId(name)) {
    logger.fail(
      `Unknown seat "${name}". Where: --next. Saw a name no gauge is drawn for; wanted one of ${MODEL_TARGETS.join(', ')}.`,
    )
    return 1
  }
  warnIfSeatDown(name)
  // The SAME registry call the caret makes - the CLI and the click have to step
  // to the same model or the two disagree about where you are. It reads only
  // local files, so neither prompts for a credential.
  const next = advanceModelTarget(name)
  if (next === undefined) {
    const target = readModelTarget(name)
    logger.warn(
      `${target.label} has nothing to step to: ${target.candidates.length} model(s) known. Fix: run --list ${name} to refresh the list.`,
    )
    return 0
  }
  logger.success(`${readModelTarget(name).label} now runs ${next}`)
  return 0
}

/**
 * One line when the clicked seat's fresh probes all fail. A click is exactly
 * where "is this available" gets asked, so the handler answers from the
 * watcher's record rather than leaving the operator to find out from a dead
 * endpoint. A warning, never a refusal: the selection is the operator's to
 * make, and the record may be mid-flap.
 */
export function warnIfSeatDown(name: string): void {
  if (name !== 'fireworks-ai' && name !== 'synthetic') {
    return
  }
  const table = readAvailabilityTable()
  const state = servingStateFor(name, table, Date.now())
  if (state === 'down') {
    logger.warn(
      `${PROVIDER_META[name].label} is not serving per the latest probes - the selection advances, and requests will route to a dead seat until the watcher sees it recover.`,
    )
  } else if (state === 'unknown') {
    logger.log(
      `${PROVIDER_META[name].label} has no fresh probe on record - the watch daemon may not be running yet; it writes one pass per minute.`,
    )
  }
}

/**
 * Choose one provider's model from an arrow-key list.
 *
 * The caret on the statusline steps ONE model per click, which is a reasonable
 * way to try the next thing and a poor way to reach the twenty-third. This is
 * the surface for the second case, and it is the same rows in the same order,
 * so a reader who has been cycling recognises where they are in the list.
 */
export async function pickProvider(name: string): Promise<number> {
  if (!isGaugeProvider(name)) {
    logger.fail(
      `Unknown provider "${name}". Where: --pick. Saw a name no gauge is drawn for; wanted one of ${GAUGE_PROVIDERS.join(', ')}.`,
    )
    return 1
  }
  if (!providerModelIsSelectable(name)) {
    logger.fail(
      `${PROVIDER_META[name].label} takes no model override. Where: --pick ${name}. Saw a provider that runs whatever its own config names; wanted one the fleet routes by id. Fix: change the model in that tool's config.`,
    )
    return 1
  }
  // Refused rather than attempted without a terminal. An interactive prompt
  // with no TTY does not fail, it WAITS - in CI or a piped shell that is a hang
  // with no output, which is the worst of the three possible behaviours.
  if (!process.stdin.isTTY) {
    logger.fail(
      `No terminal to prompt on. Where: --pick ${name}. Saw stdin is not a TTY; wanted an interactive shell. Fix: use --set ${name} --model <id>, or --list ${name} to see the choices.`,
    )
    return 1
  }
  const rows = await livePickerRowsFor(name)
  const ids = rows.map(row => row.id)
  const chosen = await select({
    choices: renderPromptChoices({
      choices: rows,
      name,
      title: PROVIDER_META[name].label,
    }),
    default: selectedModel(name),
    // Long enough that a provider's whole family fits on one screen, short
    // enough to leave the surrounding shell visible.
    pageSize: 15,
    message: `Model for ${PROVIDER_META[name].label}`,
  })
  // Undefined is a cancelled prompt, which is a decision to change nothing.
  if (chosen === undefined) {
    logger.log(`${PROVIDER_META[name].label} unchanged`)
    return 0
  }
  try {
    writeModelSelection(name, chosen, ids)
  } catch (e) {
    logger.fail(errorMessage(e))
    return 1
  }
  logger.success(`${PROVIDER_META[name].label} now runs ${chosen}`)
  return 0
}

export async function main(): Promise<number> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      list: { type: 'string' },
      model: { type: 'string' },
      next: { type: 'string' },
      pick: { type: 'string' },
      set: { type: 'string' },
    },
    strict: false,
  })

  const nextTarget = values['next']
  if (typeof nextTarget === 'string') {
    return advanceProvider(nextTarget)
  }

  const pickTarget = values['pick']
  if (typeof pickTarget === 'string') {
    return await pickProvider(pickTarget)
  }

  const listTarget = values['list']
  if (typeof listTarget === 'string') {
    if (!isGaugeProvider(listTarget)) {
      logger.fail(
        `Unknown provider "${listTarget}". Where: --list. Saw a name no gauge is drawn for; wanted one of ${GAUGE_PROVIDERS.join(', ')}.`,
      )
      return 1
    }
    const rows = await livePickerRowsFor(listTarget)
    for (const line of renderPickerLines({
      choices: rows,
      name: listTarget,
      title: PROVIDER_META[listTarget].label,
    })) {
      logger.log(line)
    }
    return 0
  }

  const setTarget = values['set']
  if (typeof setTarget === 'string') {
    const model = values['model']
    if (!isGaugeProvider(setTarget)) {
      logger.fail(
        `Unknown provider "${setTarget}". Where: --set. Saw a name no gauge is drawn for; wanted one of ${GAUGE_PROVIDERS.join(', ')}.`,
      )
      return 1
    }
    if (typeof model !== 'string' || model.length === 0) {
      logger.fail(
        `No model given. Where: --set ${setTarget}. Saw no --model; wanted an id. Fix: run --list ${setTarget} to see what it serves.`,
      )
      return 1
    }
    try {
      // The live list is passed so a model the provider currently serves is
      // accepted even when the curated catalog has no opinion about it.
      writeModelSelection(setTarget, model, await listProviderModels(setTarget))
    } catch (e) {
      logger.fail(errorMessage(e))
      return 1
    }
    logger.success(`${PROVIDER_META[setTarget].label} now runs ${model}`)
    return 0
  }

  logger.log('Offload models in use:')
  for (const line of summaryLines()) {
    logger.log(line)
  }
  logger.log('')
  logger.log(
    `Change one: pnpm run offload:model --pick <provider>  (--set <provider> --model <id> to script it)`,
  )
  return 0
}

export const SCRIPT_META: ScriptMeta = {
  describe:
    'shows and changes which model each offload provider runs for the routed agents',
  help: `Usage: pnpm run offload:model [flags]

  --list <provider>            every model that provider serves today
  --next <provider>            step one model down that list, wrapping at the end
  --pick <provider>            choose from that list interactively
  --set <provider> --model ID  point it at one

Providers: ${GAUGE_PROVIDERS.join(', ')}

The choice is stored per machine and read by the routed agents, so it changes
what code-reviewer, fix, and refactor-cleaner actually run. The report page's
dropdown writes the same file.`,
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
/* c8 ignore stop */
