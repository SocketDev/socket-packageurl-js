/**
 * @file Which fleet subagent runs on which NON-Anthropic backend, and the exact
 *   argv that runs it there. Two things live here because they fail together:
 *   the routing table, and the command builder that honours it.
 *   WHY A TABLE. A subagent spawned through the Agent tool is always a Claude
 *   seat: the tool has no other executor. Offloading one therefore means its
 *   definition routes the WORK out through a CLI while the Claude side stays a
 *   thin router. Which agent goes where is a decision, so it is written once
 *   here rather than restated in six prose files that drift.
 *   WHY A COMMAND BUILDER. `codex` takes `--sandbox` and `--ask-for-approval`
 *   as TOP-LEVEL flags, before the `exec` subcommand. Written after it, codex
 *   exits with `unexpected argument '--ask-for-approval'`, and the lockdown
 *   guard reads the flag as present either way. So the wrong order looks
 *   compliant and cannot run. Building the argv here means no caller writes
 *   those flags by hand and the ordering is pinned by a test.
 */

import { selectedModel } from './model-choices.mts'

import { PROVIDER_FIREWORKS, PROVIDER_SYNTHETIC } from './offload-spend.mts'
import type { GaugeProvider } from './offload-spend.mts'

/**
 * A backend that bills somewhere other than the metered Claude seat.
 */
export type OffloadBackend = 'codex' | 'opencode'

/**
 * Codex's sandbox policy. `danger-full-access` is deliberately absent: the
 * lockdown guard forbids it, so it is not a value this module can express.
 */
export type CodexSandbox = 'read-only' | 'workspace-write'

export interface AgentRoute {
  /**
   * The fleet agent's `name:` in its Markdown frontmatter.
   */
  readonly agent: string
  readonly backend: OffloadBackend
  /**
   * The model id as the backend names it. Empty for codex, which runs the
   * seat's own model rather than one named per call.
   */
  readonly model: string
  /**
   * Whether the routed work may write, which sets codex's sandbox.
   */
  readonly writes: boolean
  /**
   * Why this agent goes to this backend. One sentence, for the reader.
   */
  readonly why: string
}

/**
 * The fleet agents whose work is offloaded, and where each goes.
 *
 * `security-reviewer` is absent on purpose. It grades this repo's own security
 * posture against rules that live in `CLAUDE.md`, and a grade is the one output
 * where an independent-but-uninstructed model is worse than an expensive
 * informed one. Everything mechanical is routed.
 */
export const AGENT_ROUTES: readonly AgentRoute[] = [
  {
    agent: 'code-reviewer',
    backend: 'opencode',
    model: 'fireworks-ai/accounts/fireworks/models/kimi-k2p7-code',
    why: 'A first-pass review is pattern matching against written rules, which a code model does well and cheaply.',
    writes: false,
  },
  {
    agent: 'fix',
    backend: 'opencode',
    model: 'fireworks-ai/accounts/fireworks/models/kimi-k2p7-code',
    why: 'The judgement already happened in the review; applying a diagnosed finding is mechanical.',
    writes: true,
  },
  {
    agent: 'refactor-cleaner',
    backend: 'opencode',
    model: 'fireworks-ai/accounts/fireworks/models/kimi-k2p7-code',
    why: 'Dead-code removal and batched mechanical edits, each verified by the project scripts.',
    writes: true,
  },
  {
    agent: 'pr-feedback',
    backend: 'codex',
    model: '',
    why: 'Answering review threads needs a long agentic loop over a live repo, which the ChatGPT seat absorbs at no metered cost.',
    writes: true,
  },
  {
    agent: 'pr-review',
    backend: 'codex',
    model: '',
    why: 'The discovery pass over a diff is a long read-heavy loop the ChatGPT seat absorbs at no metered cost; the Claude side stays the router that verifies a finding before posting it.',
    writes: true,
  },
]

/**
 * The route for an agent, or undefined when it stays on the Claude seat.
 */
export function routeForAgent(agent: string): AgentRoute | undefined {
  for (let i = 0, { length } = AGENT_ROUTES; i < length; i += 1) {
    const route = AGENT_ROUTES[i]!
    if (route.agent === agent) {
      return route
    }
  }
  return undefined
}

/**
 * The model a route actually runs.
 *
 * The picker's stored choice wins over the table's default, which is the whole
 * point of the picker: a selection that did not change what runs would be a
 * control that lied. The table's entry stays as the FALLBACK, so a machine with
 * no selection - or one naming a model the provider has since retired - runs
 * the fleet's pick rather than nothing.
 */
export function modelForRoute(route: AgentRoute): string {
  const provider = providerOfModel(route.model)
  if (provider === undefined) {
    return route.model
  }
  return selectedModel(provider)
}

/**
 * Which gauge provider a model id belongs to, by its routing prefix.
 */
export function providerOfModel(modelId: string): GaugeProvider | undefined {
  if (modelId.startsWith('fireworks-ai/')) {
    return PROVIDER_FIREWORKS
  }
  if (modelId.startsWith('synthetic/')) {
    return PROVIDER_SYNTHETIC
  }
  return undefined
}

export interface OffloadCommand {
  readonly args: readonly string[]
  readonly bin: string
}

/**
 * The argv that runs `prompt` on a route's backend.
 *
 * Codex's lockdown flags go BEFORE `exec` because they are top-level flags;
 * after it, codex refuses to start. The sandbox follows the route's own
 * `writes`, so a read-only agent cannot be handed a writable sandbox by a
 * caller who forgot.
 */
export function offloadCommand(
  route: AgentRoute,
  prompt: string,
): OffloadCommand {
  if (route.backend === 'codex') {
    const sandbox: CodexSandbox = route.writes ? 'workspace-write' : 'read-only'
    return {
      args: [
        '--sandbox',
        sandbox,
        '--ask-for-approval',
        'never',
        'exec',
        prompt,
      ],
      bin: 'codex',
    }
  }
  return {
    args: ['run', '-m', modelForRoute(route), prompt],
    bin: 'opencode',
  }
}
