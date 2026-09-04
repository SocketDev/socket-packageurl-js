// Fleet check — every fleet subagent is either offloaded or says why it is not.
//
// A subagent spawned through the Agent tool is always a Claude seat. Offloading
// one means its Markdown definition routes the WORK out through a CLI while the
// Claude side stays a thin router. That makes the routing a fact in two places:
// the table in `_shared/agent-offload.mts`, and the prose each agent's file
// tells the model to follow.
//
// Two ways that pair goes wrong, both silent:
//
//   1. The table routes an agent the file knows nothing about. The agent runs
//      entirely on the metered seat while the table reports it offloaded, so
//      the saving is on paper only.
//   2. An agent file is added with no entry either way. Nobody decided where it
//      runs, and the default is the expensive one.
//
// A Claude-native agent is legitimate: `security-reviewer` grades this repo's
// own posture and wants the informed expensive model. It declares that with an
// `offload: none` line, so the absence is a decision on the record rather than
// an oversight.
//
// Exit codes: 0 — every agent is routed or declares `offload: none`; 1 — at
// least one disagrees with the table or declares nothing.
//
// Usage: node scripts/fleet/check/agent-offload-routes-are-declared.mts [--quiet]

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { globSync } from '@socketsecurity/lib-stable/globs/match'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { AGENT_ROUTES, routeForAgent } from '../ai/agent-offload.mts'
import { isMainModule } from '../process/is-main-module.mts'
import { runMain } from '../process/run-main.mts'
import { REPO_ROOT } from '../paths.mts'

import type { ScriptMeta } from '../process/run-main.mts'

const logger = getDefaultLogger()

/**
 * The marker an agent file uses to opt out of offloading, with its reason.
 */
export const OPT_OUT_MARKER = 'offload: none'

export interface AgentDeclaration {
  readonly agent: string
  readonly declaresBackend: boolean
  readonly file: string
  readonly optsOut: boolean
}

/**
 * Read what an agent file says about where it runs.
 *
 * `declaresBackend` looks for the backend NAME in the body rather than parsing
 * frontmatter, because the routing instruction is prose the model reads, not a
 * field the harness consumes. A file that names its backend is one whose reader
 * will actually route there.
 */
export function readAgentDeclaration(
  file: string,
  text: string,
): AgentDeclaration {
  const agent =
    /^name:\s*(?<agent>\S+)/m.exec(text)?.groups?.['agent'] ??
    path.basename(file, '.md')
  const route = routeForAgent(agent)
  return {
    agent,
    declaresBackend:
      route !== undefined &&
      text.includes(route.backend) &&
      (route.model === '' || text.includes(route.model)),
    file,
    optsOut: text.includes(OPT_OUT_MARKER),
  }
}

/**
 * Every disagreement between the table and the agent files.
 */
export function findRoutingGaps(
  declarations: readonly AgentDeclaration[],
): string[] {
  const gaps: string[] = []
  for (const decl of declarations) {
    const route = routeForAgent(decl.agent)
    if (route === undefined) {
      if (!decl.optsOut) {
        gaps.push(
          `${decl.file}: '${decl.agent}' has no entry in AGENT_ROUTES and no '${OPT_OUT_MARKER}' line. Saw an agent nobody decided where to run; wanted either a route or a recorded opt-out. Fix: add it to AGENT_ROUTES in scripts/fleet/ai/agent-offload.mts, or add a '${OPT_OUT_MARKER}' line naming why it stays on the Claude seat.`,
        )
      }
      continue
    }
    if (decl.optsOut) {
      gaps.push(
        `${decl.file}: '${decl.agent}' is routed to ${route.backend} in AGENT_ROUTES but the file declares '${OPT_OUT_MARKER}'. Saw two answers; wanted one. Fix: remove the opt-out line, or remove the route.`,
      )
      continue
    }
    if (!decl.declaresBackend) {
      gaps.push(
        `${decl.file}: '${decl.agent}' is routed to ${route.backend} in AGENT_ROUTES but its instructions never name that backend${route.model === '' ? '' : ` or the model ${route.model}`}. Saw an agent that will run on the metered seat while the table reports it offloaded; wanted instructions that route the work out. Fix: tell the agent to run its work through ${route.backend}.`,
      )
    }
  }
  return gaps
}

/**
 * The agent files this check reads.
 */
export function agentFiles(root: string = REPO_ROOT): string[] {
  return globSync(['.claude/agents/fleet/*.md'], { absolute: true, cwd: root })
}

export async function main(): Promise<number> {
  const quiet = process.argv.includes('--quiet')
  const files = agentFiles()
  if (files.length === 0) {
    logger.fail(
      `No fleet agent files found. Where: .claude/agents/fleet/*.md. Saw an empty glob; wanted at least one agent. Fix: run the cascade so the fleet agents are materialised.`,
    )
    return 1
  }

  const declarations = files.map(file =>
    readAgentDeclaration(
      path.relative(REPO_ROOT, file),
      readFileSync(file, 'utf8'),
    ),
  )
  const gaps = findRoutingGaps(declarations)

  if (gaps.length > 0) {
    for (const gap of gaps) {
      logger.fail(gap)
    }
    return 1
  }

  if (!quiet) {
    const routed = declarations.filter(d => routeForAgent(d.agent)).length
    logger.success(
      `${routed} of ${declarations.length} fleet agents offloaded; ${declarations.length - routed} declared Claude-native.`,
    )
  }
  return 0
}

export const SCRIPT_META: ScriptMeta = {
  describe:
    'asserts every fleet subagent is either routed to an offload backend or records why it stays on the Claude seat',
  help: `Usage: node scripts/fleet/check/agent-offload-routes-are-declared.mts [--quiet]

  --quiet   report only failures

The routing table is scripts/fleet/ai/agent-offload.mts. An agent that
should stay on the Claude seat says so with an '${OPT_OUT_MARKER}' line, so the
absence of a route is a decision on the record rather than an oversight.

Currently routed: ${AGENT_ROUTES.map(r => `${r.agent} -> ${r.backend}`).join(', ')}`,
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
/* c8 ignore stop */
