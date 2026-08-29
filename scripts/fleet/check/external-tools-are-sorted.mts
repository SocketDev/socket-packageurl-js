// Fleet check — every external-tools.json's `tools` keys are
// alphanumerically sorted.
//
// A manifest with unsorted tools drifts from the canonical order `sort.mts`
// establishes, so a new entry appended at the bottom can hide among
// out-of-order siblings instead of standing out. This check compares
// `Object.keys(tools)` to its sorted form and fails (exit 1) naming the
// out-of-order keys, so the gate catches the drift at `check --all` before a
// cascade ships it.
//
// Scoped to the source-of-truth manifests: a live cascaded mirror and its
// template twin are one defect, and only the twin can be fixed (the mirror is
// mode 444 and rehydrates). dogfood-is-current.mts owns their equality.
//
// Usage: node scripts/fleet/check/external-tools-are-sorted.mts [--quiet]

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { resolveSourceRelativePaths } from '../external-tools/_shared.mts'
import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

export interface SortIssue {
  readonly file: string
  readonly firstOutOfOrder: string
  readonly expectedAt: number
  readonly foundAt: number
}

/**
 * The sort violations across every shipped manifest, empty when all are
 * alphanumerically sorted. Pure — reads + compares, no mutation.
 */
export function scanSort(repoRoot: string): SortIssue[] {
  const issues: SortIssue[] = []
  const relPaths = resolveSourceRelativePaths()
  for (let i = 0, { length } = relPaths; i < length; i += 1) {
    const rel = relPaths[i]!
    const abs = path.join(repoRoot, rel)
    if (!existsSync(abs)) {
      continue
    }
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(abs, 'utf8'))
    } catch {
      // The schema validator covers parse errors; skip here.
      continue
    }
    const tools =
      typeof raw === 'object' &&
      raw !== null &&
      'tools' in raw &&
      typeof (raw as { tools: unknown })['tools'] === 'object'
        ? (raw as { tools: Record<string, unknown> })['tools']
        : undefined
    if (!tools) {
      continue
    }
    const keys = Object.keys(tools)
    const sorted = [...keys].toSorted()
    for (let j = 0, { length: len } = keys; j < len; j += 1) {
      if (keys[j] !== sorted[j]) {
        issues.push({
          file: rel,
          firstOutOfOrder: keys[j]!,
          expectedAt: j,
          foundAt: sorted.indexOf(keys[j]!),
        })
        break
      }
    }
  }
  return issues
}

export function main(): void {
  const quiet = process.argv.includes('--quiet')
  const issues = scanSort(REPO_ROOT)
  if (issues.length > 0) {
    logger.fail(
      '[check-external-tools-are-sorted] tool keys are not alphanumerically sorted:',
    )
    for (let i = 0, { length } = issues; i < length; i += 1) {
      const it = issues[i]!
      logger.fail(
        `  ${it.file}: "${it.firstOutOfOrder}" at index ${it.expectedAt}, ` +
          `expected at index ${it.foundAt}`,
      )
    }
    logger.error('  Fix:   node scripts/fleet/external-tools/sort.mts --apply')
    process.exitCode = 1
    return
  }
  if (!quiet) {
    logger.success(
      '[check-external-tools-are-sorted] every manifest is alphanumerically sorted.',
    )
  }
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'checks every external-tools.json tool keys are alphanumerically sorted',
  help: `Usage: node scripts/fleet/check/external-tools-are-sorted.mts [flags]

  --quiet  suppress the pass message`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
