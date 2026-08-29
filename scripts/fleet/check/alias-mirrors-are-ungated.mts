#!/usr/bin/env node
/*
 * @file `check --all` gate: no script gates, regenerates, or reconciles a
 *   CROSS-TOOL ALIAS MIRROR (`.agents/`, `.codex/`, `.cursor/`).
 *
 *   An alias mirror is a derived copy of `.claude/**` that another agent tool
 *   reads. It is gitignored, the fleet pack rebuilds it on every release, and
 *   the pack's downloader places it. "Stale" is therefore never a state a human
 *   must act on, so a check reporting it costs attention and CI minutes for
 *   nothing: one such drift report failed CI with 15 "missing mirror file"
 *   lines naming skills the next release delivers anyway.
 *
 *   Still fine, and deliberately not matched: IGNORING an alias dir, DELETING
 *   one, and the `.gitignore` entry that keeps it untracked. This gate is about
 *   spending cycles deciding whether a derived copy is current, not about
 *   tolerating one on disk.
 *
 *   Pure `findAliasMirrorGates` is exported for unit tests. Usage: node
 *   scripts/fleet/check/alias-mirrors-are-ungated.mts [path…]
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import { REPO_ROOT } from '../paths.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

// The cross-tool alias directories: each holds a derived copy of `.claude/**`
// that a different agent tool reads, each delivered by the fleet pack.
export const ALIAS_MIRROR_DIRS: readonly string[] = [
  '.agents',
  '.codex',
  '.cursor',
]

// The asset subtrees that are MIRRORS of `.claude/**`. Scoped this narrowly
// because an alias dir also holds real config the operator wants written -
// `.codex/config.toml` wires MCP servers and is nobody's derived copy - so
// gating the whole directory would forbid legitimate generation.
const MIRRORED_ASSET_DIRS: readonly string[] = [
  'agents',
  'commands',
  'prompts',
  'rules',
  'skills',
]

// Verbs that mean "decide whether the mirror is current" - the work this gate
// forbids. `ignore` and `delete` are absent on purpose, and so is `mirror`:
// that one is the noun, and prose calling a path "the .agents/ mirror" while
// EXCLUDING it is exactly what must keep passing.
const GATING_VERBS: readonly string[] = ['drift', 'regen', 'stale', 'sync']

// A comment states intent; only executable code spends the cycles. Every hit in
// the first tree-wide run was prose, and gating on prose would push authors to
// stop describing the exclusion rather than stop performing it.
const COMMENT_PREFIXES: readonly string[] = ['*', '//', '#']

export interface AliasMirrorGate {
  readonly dir: string
  readonly file: string
  readonly line: number
  readonly text: string
}

/**
 * Every line in `sources` naming an alias mirror dir beside a gating verb.
 *
 * Pure: the caller supplies `[path, contents]` pairs, so one function serves
 * the check and its tests.
 */
export function findAliasMirrorGates(
  sources: Iterable<readonly [string, string]>,
): AliasMirrorGate[] {
  const gates: AliasMirrorGate[] = []
  for (const [file, contents] of sources) {
    const lines = contents.split(/\r?\n/)
    for (let i = 0, { length } = lines; i < length; i += 1) {
      const text = lines[i]!
      const trimmed = text.trim()
      if (COMMENT_PREFIXES.some(prefix => trimmed.startsWith(prefix))) {
        continue
      }
      const lowered = text.toLowerCase()
      if (!GATING_VERBS.some(verb => lowered.includes(verb))) {
        continue
      }
      for (
        let j = 0, { length: dirsLength } = ALIAS_MIRROR_DIRS;
        j < dirsLength;
        j += 1
      ) {
        const dir = ALIAS_MIRROR_DIRS[j]!
        const mirrored = MIRRORED_ASSET_DIRS.some(asset =>
          text.includes(`${dir}/${asset}`),
        )
        if (!mirrored) {
          continue
        }
        gates.push({
          dir,
          file: normalizePath(file),
          line: i + 1,
          text: text.trim(),
        })
        break
      }
    }
  }
  return gates
}

// The script trees a gate could live in. Scanned when no paths are given, so
// the check runs itself rather than depending on a caller to enumerate.
const SCANNED_GLOBS: readonly string[] = [
  'scripts/**/*.mts',
  'template/base/scripts/**/*.mts',
]

async function main(): Promise<number> {
  const named = process.argv.slice(2).filter(arg => !arg.startsWith('-'))
  const scanned: string[] = [...named]
  if (scanned.length === 0) {
    const { glob } = await import('node:fs/promises')
    for (let i = 0, { length } = SCANNED_GLOBS; i < length; i += 1) {
      for await (const entry of glob(SCANNED_GLOBS[i]!)) {
        scanned.push(entry)
      }
    }
  }
  const sources: Array<readonly [string, string]> = []
  for (let i = 0, { length } = scanned; i < length; i += 1) {
    const rel = scanned[i]!
    try {
      sources.push([rel, readFileSync(path.join(REPO_ROOT, rel), 'utf8')])
    } catch {
      // Unreadable or absent: nothing to judge.
    }
  }
  const gates = findAliasMirrorGates(sources)
  if (gates.length === 0) {
    logger.success(
      'alias-mirrors-are-ungated: no script decides whether an alias mirror is current.',
    )
    return 0
  }
  logger.fail(`${gates.length} alias-mirror gate(s) found:`)
  logger.group()
  for (let i = 0, { length } = gates; i < length; i += 1) {
    const gate = gates[i]!
    logger.error(`${gate.file}:${gate.line} — ${gate.text}`)
  }
  logger.groupEnd()
  logger.group()
  logger.info(
    'What: a script spends cycles deciding whether a derived alias mirror is current.',
  )
  logger.info(`Where: the lines above (${ALIAS_MIRROR_DIRS.join(', ')}).`)
  logger.info(
    'Saw: a gating verb beside an alias dir; wanted no gate. The mirror is gitignored, every release rebuilds it, and the downloader places it, so stale is not a state a human acts on.',
  )
  logger.info(
    'Fix: delete the gate and its call sites. Ignoring the directory, deleting it, and its .gitignore entry all stay fine.',
  )
  logger.groupEnd()
  return 1
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'check that no script gates or regenerates a cross-tool alias mirror',
  help: `Usage: node scripts/fleet/check/alias-mirrors-are-ungated.mts [path…]

  With no paths, scans scripts/** and template/base/scripts/**. Reports any
  file whose code names an alias mirror subtree beside a gating verb
  (drift/regen/stale/sync). Comments, and real config the operator wants
  written, are left alone. No --fix: deleting a gate means deleting its call
  sites and tests too.`,
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
/* c8 ignore stop */
