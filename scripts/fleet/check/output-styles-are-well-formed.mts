#!/usr/bin/env node
/**
 * @file `check --all` gate: every `.claude/output-styles/*.md` is a usable
 *   output style.
 *   An output style is loaded by NAME from its frontmatter, not by filename, so
 *   a missing or mismatched `name:` produces a style that either cannot be
 *   selected or answers to something other than the file a reader opens. A
 *   missing `description:` leaves the picker with a blank row.
 *   The description cap is the skills cap for the same reason: a cross-agent
 *   picker truncates or drops long rows, so a style that reads fine here goes
 *   missing in Codex or OpenCode.
 *   Output styles were the one artifact kind with no gate at all, which is why
 *   this exists rather than a rule being added to an existing check. Exit: 0 -
 *   every style is well-formed; 1 - a style is missing a part. Usage: node
 *   scripts/fleet/check/output-styles-are-well-formed.mts [--quiet]
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import {
  extractFrontmatter,
  frontmatterValue,
  MAX_SKILL_DESCRIPTION_LENGTH,
} from './skills-are-well-formed.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

const quiet = process.argv.includes('--quiet')

/**
 * Where output styles live, relative to the tree that owns them.
 */
export const OUTPUT_STYLES_DIR = path.join('.claude', 'output-styles')

/**
 * One thing wrong with one style.
 */
export interface StyleDefect {
  readonly file: string
  readonly reason: string
}

/**
 * Whether `name` could address the file it lives in.
 *
 * Claude Code selects a style by its frontmatter `name`, so the two only have
 * to be RELATED, not identical: `fleet.md` legitimately declares `Fleet`.
 * Compared case-insensitively with separators dropped, which catches a
 * copy-paste that left another style's name behind.
 */
export function nameMatchesFile(name: string, file: string): boolean {
  const normalize = (value: string): string =>
    value.toLowerCase().replaceAll(/[\s_-]/g, '')
  return normalize(name) === normalize(path.basename(file, '.md'))
}

/**
 * Everything wrong with one style's source.
 */
export function styleDefects(file: string, source: string): StyleDefect[] {
  const defects: StyleDefect[] = []
  const frontmatter = extractFrontmatter(source)
  if (!frontmatter) {
    return [
      {
        file,
        reason:
          'no `---` frontmatter block, so it cannot be selected by name at all',
      },
    ]
  }
  const name = frontmatterValue(frontmatter, 'name')
  if (!name) {
    defects.push({
      file,
      reason: 'no `name:`, and the style is selected by name rather than path',
    })
  } else if (!nameMatchesFile(name, file)) {
    defects.push({
      file,
      reason: `\`name: ${name}\` does not address ${path.basename(file)}, so the file a reader opens is not the style they selected`,
    })
  }
  const description = frontmatterValue(frontmatter, 'description')
  if (!description) {
    defects.push({
      file,
      reason: 'no `description:`, which leaves the picker a blank row',
    })
  } else if (description.length > MAX_SKILL_DESCRIPTION_LENGTH) {
    defects.push({
      file,
      reason: `\`description:\` is ${description.length} chars; keep it <= ${MAX_SKILL_DESCRIPTION_LENGTH} so a cross-agent picker does not truncate it`,
    })
  }
  const body = source.slice(source.indexOf('\n---', 3) + 4).trim()
  if (!body) {
    defects.push({
      file,
      reason: 'frontmatter only, no prose - selecting it would change nothing',
    })
  }
  return defects
}

/**
 * Every defect across every style in `repoRoot`.
 */
export function scan(repoRoot: string): StyleDefect[] {
  const base = existsSync(path.join(repoRoot, 'template', 'base'))
    ? path.join(repoRoot, 'template', 'base')
    : repoRoot
  const dir = path.join(base, OUTPUT_STYLES_DIR)
  if (!existsSync(dir)) {
    return []
  }
  const defects: StyleDefect[] = []
  const names = readdirSync(dir).filter(n => n.endsWith('.md'))
  for (let i = 0, { length } = names; i < length; i += 1) {
    const rel = path.join(OUTPUT_STYLES_DIR, names[i]!)
    let source = ''
    try {
      source = readFileSync(path.join(dir, names[i]!), 'utf8')
    } catch {
      continue
    }
    defects.push(...styleDefects(rel, source))
  }
  return defects
}

export function main(): void {
  const defects = scan(REPO_ROOT)
  if (defects.length === 0) {
    if (!quiet) {
      logger.log(
        'output-styles-are-well-formed: every output style declares a matching name, a picker-sized description, and prose.',
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
    'checks every .claude/output-styles/*.md declares a name, description and prose',
  help: `Usage: node scripts/fleet/check/output-styles-are-well-formed.mts [flags]
  --quiet  suppress the success message`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
