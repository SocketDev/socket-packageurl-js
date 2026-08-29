/**
 * @file Every seat whose model a caret can step, and where each one's choice
 *   actually lives. FOUR SEATS, THREE DIFFERENT STORES. The two OpenCode
 *   providers share the fleet's own selection file. Codex reads a key out of
 *   its own `config.toml`. Claude Code reads one out of its own
 *   `settings.json`. Nothing unifies those at the filesystem, so they are
 *   unified HERE, behind one shape, and every caller works in terms of "step
 *   this seat" rather than knowing which file to open. WHY IT MATTERS THAT ALL
 *   FOUR ARE HERE. The statusline draws four gauges as one instrument cluster.
 *   A caret on two of them and not the others reads as broken rather than as
 *   deliberate, so "this seat cannot be changed" is not an acceptable answer
 *   for any of them - the answer is to find the file that decides it. NO
 *   CREDENTIAL, NO NETWORK. Every read here is a local file, because a caret
 *   click is a fresh process and any keychain read in it is an OS auth prompt
 *   per click. The candidate list for the API-key providers comes from the
 *   model cache for exactly that reason.
 */

import {
  CLAUDE_MODELS,
  claudeSettingsPath,
  readClaudeModel,
  writeClaudeModel,
} from './claude-model.mts'
import {
  listFireconnectModels,
  readFireconnectClaudeStatus,
  restoreClaudeDefaultRoute,
  routeClaudeThroughFireworks,
} from './fireconnect-claude.mts'
import {
  CODEX_MODELS,
  codexConfigPath,
  readCodexModel,
  writeCodexModel,
} from './codex-model.mts'
import { existsSync } from 'node:fs'

import {
  cachedPickerRowsFor,
  selectedModel,
  writeModelSelection,
} from './model-choices.mts'
import { CLAUDE_TARGET } from './model-target-ids.mts'
import { PROVIDER_META, PROVIDER_OPENAI } from './offload-spend.mts'
import { providerModelIsSelectable } from './provider-apis.mts'

import type { ModelTargetId } from './model-target-ids.mts'
import type { GaugeProvider } from './offload-spend.mts'

// Re-exported so a caller that reads or writes a target keeps naming one from
// here; the identifiers live in a leaf module because this one spawns.
export {
  CLAUDE_TARGET,
  isModelTargetId,
  MODEL_TARGETS,
} from './model-target-ids.mts'
export type { ModelTargetId } from './model-target-ids.mts'

export interface ModelTarget {
  /**
   * The ordered cycle list. Empty means there is nothing to step to, which the
   * caller reports rather than treating as an error.
   */
  readonly candidates: readonly string[]
  /**
   * Whether this machine has the seat set up at all. False hides its gauge.
   */
  readonly configured: boolean
  /**
   * What it runs now, or undefined when nothing configures it.
   */
  readonly current: string | undefined
  readonly id: ModelTargetId
  readonly label: string
}

/**
 * Read a seat's current state: what it runs, what it could run, and whether it
 * is set up here.
 */
export function readModelTarget(id: ModelTargetId): ModelTarget {
  if (id === CLAUDE_TARGET) {
    const status = readFireconnectClaudeStatus()
    return {
      // Native aliases first, then whatever FireConnect can route to. Stepping
      // off the last alias is what turns routing ON, and wrapping past the last
      // Fireworks model is what turns it back off, so the whole decision is one
      // caret rather than a mode switch the reader has to find.
      candidates: [...CLAUDE_MODELS, ...(listFireconnectModels() ?? [])],
      configured: existsSync(claudeSettingsPath()),
      // FireConnect is the authority when it is installed, because it is what
      // rewrote the settings; the raw settings key is the answer only when
      // nothing is routing the seat.
      current: status?.model ?? readClaudeModel(),
      id,
      label: 'claude',
    }
  }
  if (id === PROVIDER_OPENAI) {
    return {
      candidates: CODEX_MODELS,
      configured: existsSync(codexConfigPath()),
      current: readCodexModel(),
      id,
      label: PROVIDER_META[id].label,
    }
  }
  const provider: GaugeProvider = id
  return {
    // The CACHED list, never a live one - see the @file header.
    candidates: cachedPickerRowsFor(provider).map(row => row.id),
    configured: providerModelIsSelectable(provider),
    current: selectedModel(provider),
    id,
    label: PROVIDER_META[provider].label,
  }
}

/**
 * Point a seat at a model, in whichever file decides it. True when something
 * changed.
 *
 * False rather than a throw on every failure path. The caller is usually a
 * click, which has no console to report one to, and the gauge showing the old
 * model IS the report.
 */
export function writeModelTarget(id: ModelTargetId, model: string): boolean {
  if (id === CLAUDE_TARGET) {
    // A native alias means the seat belongs on Anthropic, so routing comes OFF
    // first - FireConnect restores the settings it replaced from its own
    // backup, and writing the alias underneath a live gateway would be a
    // setting the gateway then ignores.
    if ((CLAUDE_MODELS as readonly string[]).includes(model)) {
      restoreClaudeDefaultRoute()
      return writeClaudeModel(model)
    }
    return routeClaudeThroughFireworks(model)
  }
  if (id === PROVIDER_OPENAI) {
    return writeCodexModel(model)
  }
  try {
    writeModelSelection(id, model, readModelTarget(id).candidates)
    return true
  } catch {
    return false
  }
}

/**
 * Step a seat one model down its list, wrapping at the end. The new model, or
 * undefined when there was nothing to move to.
 *
 * The one implementation behind BOTH the caret and `offload:model --next`, so
 * the click and the command can never disagree about which model is next.
 */
export function advanceModelTarget(id: ModelTargetId): string | undefined {
  const target = readModelTarget(id)
  if (target.candidates.length < 2) {
    return undefined
  }
  const at = target.current ? target.candidates.indexOf(target.current) : -1
  // An unknown current re-enters at the top rather than refusing: that is the
  // stale-selection case, and leaving the reader stuck on a retired model with
  // a caret that appears dead is the worse answer.
  const next =
    target.candidates[at === -1 ? 0 : (at + 1) % target.candidates.length]!
  if (next === target.current) {
    return undefined
  }
  return writeModelTarget(id, next) ? next : undefined
}
