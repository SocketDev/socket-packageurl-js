#!/usr/bin/env node
/**
 * @file `check --all` gate: every `.claude/agents/fleet/*.md` is a usable agent
 *   definition.
 *   An agent is selected by its frontmatter `name`, so a missing or mismatched
 *   name yields an agent that cannot be spawned or answers to a different file
 *   than the one a reader opens. `description` is the Agent tool's selection
 *   criteria: absent, the caller has nothing to choose on. `tools` is the
 *   explicit grant; omitting it inherits everything, which is a capability
 *   decision that should be written down rather than defaulted into.
 *   The description cap is the SKILLS cap, not a number invented here: every
 *   artifact kind a picker lists shares one budget, and Codex shortens long
 *   descriptions before it omits entries, so a long one routes worse while
 *   still looking fine locally.
 *   `model` is required. An agent with no model inherits whatever the session
 *   happens to be on, so the same agent is a different agent depending on who
 *   spawned it - the least reproducible property an artifact can have.
 *   Exit: 0 - every agent is well-formed; 1 - an agent is missing a part.
 *   Usage: node scripts/fleet/check/agents-are-well-formed.mts [--quiet]
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import { nameMatchesFile } from './output-styles-are-well-formed.mts'
import {
  extractFrontmatter,
  frontmatterValue,
  MAX_SKILL_DESCRIPTION_LENGTH,
} from './skills-are-well-formed.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

const quiet = process.argv.includes('--quiet')

/**
 * Where fleet agents live, relative to the tree that owns them.
 */
export const AGENTS_DIR = path.join('.claude', 'agents', 'fleet')

/**
 * One thing wrong with one agent.
 */
export interface AgentDefect {
  readonly file: string
  readonly reason: string
}

/**
 * Everything wrong with one agent's source.
 */
export function agentDefects(file: string, source: string): AgentDefect[] {
  const frontmatter = extractFrontmatter(source)
  if (!frontmatter) {
    return [
      {
        file,
        reason: 'no `---` frontmatter block, so it cannot be spawned by name',
      },
    ]
  }
  const defects: AgentDefect[] = []
  const name = frontmatterValue(frontmatter, 'name')
  if (!name) {
    defects.push({
      file,
      reason: 'no `name:`, and an agent is spawned by name rather than by path',
    })
  } else if (!nameMatchesFile(name, file)) {
    defects.push({
      file,
      reason: `\`name: ${name}\` does not address ${path.basename(file)}, so the file a reader opens is not the agent they spawned`,
    })
  }
  if (!frontmatterValue(frontmatter, 'description')) {
    defects.push({
      file,
      reason:
        'no `description:`, which is the Agent tool selection criteria - without it a caller has nothing to choose on',
    })
  }
  const description = frontmatterValue(frontmatter, 'description')
  if (description && description.length > MAX_SKILL_DESCRIPTION_LENGTH) {
    defects.push({
      file,
      reason: `\`description:\` is ${description.length} chars; keep it <= ${MAX_SKILL_DESCRIPTION_LENGTH}, the shared picker budget Codex shortens past`,
    })
  }
  if (!frontmatterValue(frontmatter, 'model')) {
    defects.push({
      file,
      reason:
        'no `model:` - the agent then inherits whatever model the session is on, so the same agent behaves differently depending on who spawned it',
    })
  }
  if (!frontmatterValue(frontmatter, 'tools')) {
    defects.push({
      file,
      reason:
        'no `tools:` - omitting the grant inherits every tool, which is a capability decision that belongs in the file',
    })
  }
  const body = source.slice(source.indexOf('\n---', 3) + 4).trim()
  if (!body) {
    defects.push({
      file,
      reason:
        'frontmatter only, no prompt body - spawning it would say nothing',
    })
  }
  return defects
}

/**
 * Every defect across every agent in `repoRoot`.
 */
export function scan(repoRoot: string): AgentDefect[] {
  const base = existsSync(path.join(repoRoot, 'template', 'base'))
    ? path.join(repoRoot, 'template', 'base')
    : repoRoot
  const dir = path.join(base, AGENTS_DIR)
  if (!existsSync(dir)) {
    return []
  }
  const defects: AgentDefect[] = []
  const names = readdirSync(dir).filter(n => n.endsWith('.md'))
  for (let i = 0, { length } = names; i < length; i += 1) {
    const rel = path.join(AGENTS_DIR, names[i]!)
    let source = ''
    try {
      source = readFileSync(path.join(dir, names[i]!), 'utf8')
    } catch {
      continue
    }
    defects.push(...agentDefects(rel, source))
  }
  return defects
}

export function main(): void {
  const defects = scan(REPO_ROOT)
  if (defects.length === 0) {
    if (!quiet) {
      logger.log(
        'agents-are-well-formed: every agent declares a matching name, a picker-sized description, a model, an explicit tool grant, and a prompt.',
      )
    }
    process.exitCode = 0
    return
  }
  for (let i = 0, { length } = defects; i < length; i += 1) {
    logger.fail(`${defects[i]!.file} - ${defects[i]!.reason}`)
  }
  process.exitCode = 1
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'checks every .claude/agents/fleet/*.md declares a name, description, tools and prompt',
  help: `Usage: node scripts/fleet/check/agents-are-well-formed.mts [flags]
  --quiet  suppress the success message`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
