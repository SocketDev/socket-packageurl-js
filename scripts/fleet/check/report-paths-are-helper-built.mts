#!/usr/bin/env node
/**
 * @file Fleet check - every rendered-report path is built by the shared helper,
 *   never hand-joined. The layout is one directory per producing script holding
 *   an `index.html` and an `assets/` directory beside it. A hand-built path is
 *   how that layout drifts, and the failure is quiet in the worst way: a writer
 *   that joins its own `<name>.html` still produces a file, a consumer looking
 *   for `index.html` finds nothing, and the report simply never appears with no
 *   error saying why. One constructor means the writer and the reader cannot
 *   disagree about where a report lives. The rule enforced: outside the owning
 *   helper, no tracked source file may reference `FLEET_REPORTS_DIR` directly.
 *   Every other caller asks the helper for a path. This applies the
 *   path-hygiene rule to the reports tree, where a path is constructed exactly
 *   once. Usage: node scripts/fleet/check/report-paths-are-helper-built.mts
 *   [--json] [--quiet].
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { REPO_ROOT } from '../paths.mts'
import { collectTrackedFiles } from '../fs/tracked-globs.mts'
import { isMainModule } from '../process/is-main-module.mts'
import { isJsonRequested, runMain } from '../process/run-main.mts'

import type { ScriptMeta } from '../process/run-main.mts'

const logger = getDefaultLogger()

/**
 * Files permitted to name the reports-directory constant, matched by suffix so
 * a template source and its cascaded mirror both qualify.
 *
 * Three, for three different reasons: the paths module DECLARES the constant,
 * the helper USES it to build paths, and this check SEARCHES for it and so must
 * spell the needle it looks for. Leaving the third out made the check fail on
 * itself the moment it became tracked, which is exactly how it first behaved.
 */
export const REPORTS_DIR_NAMERS: readonly string[] = [
  'scripts/fleet/spend/report-path.mts',
  'scripts/fleet/check/report-paths-are-helper-built.mts',
  'scripts/fleet/paths.mts',
]

const REPORTS_DIR_SYMBOL = 'FLEET_REPORTS_DIR'

export interface ReportPathFinding {
  readonly file: string
  readonly line: number
}

/**
 * Whether a tracked path is allowed to name the reports-directory constant.
 */
export function isReportsDirNamer(file: string): boolean {
  const normalized = normalizePath(file)
  for (let i = 0, { length } = REPORTS_DIR_NAMERS; i < length; i += 1) {
    if (normalized.endsWith(REPORTS_DIR_NAMERS[i]!)) {
      return true
    }
  }
  return false
}

/**
 * Lines in one file that name the constant. A test may reference it, so specs
 * are excluded by the caller rather than here.
 */
export function findReportsDirRefs(text: string): number[] {
  const lines = text.split(/\r?\n/)
  const hits: number[] = []
  for (let i = 0, { length } = lines; i < length; i += 1) {
    if (lines[i]!.includes(REPORTS_DIR_SYMBOL)) {
      hits.push(i + 1)
    }
  }
  return hits
}

export interface ReportPathScan {
  readonly filesScanned: number
  readonly findings: ReportPathFinding[]
}

export async function scanRepo(repoRoot: string): Promise<ReportPathScan> {
  const tracked = await collectTrackedFiles(['**/*.mts', '**/*.mjs'], {
    cwd: repoRoot,
    dot: true,
  })
  const findings: ReportPathFinding[] = []
  let filesScanned = 0
  for (
    let i = 0, { length } = tracked.length ? tracked : [];
    i < length;
    i += 1
  ) {
    const file = normalizePath(tracked[i]!)
    // A spec asserting the layout has to name the constant to assert on it, so
    // every test tree is exempt. Both spellings are needed: a repo-root spec is
    // `test/...` with no leading slash, while a workspace member's is
    // `packages/<pkg>/test/...`. Matching only the slashed form left every
    // root-level spec unexempt, which flagged this check's own spec.
    if (
      isReportsDirNamer(file) ||
      file.startsWith('test/') ||
      file.includes('/test/')
    ) {
      continue
    }
    let text: string
    try {
      text = readFileSync(path.join(repoRoot, file), 'utf8')
    } catch {
      continue
    }
    filesScanned += 1
    for (const line of findReportsDirRefs(text)) {
      findings.push({ file, line })
    }
  }
  return { filesScanned, findings }
}

export function formatFailure(scan: ReportPathScan): string {
  const lines = [
    `${scan.findings.length} file location(s) build a report path outside the shared helper.`,
    '',
  ]
  for (const finding of scan.findings) {
    lines.push(`  ${finding.file}:${finding.line}`)
  }
  lines.push(
    '',
    `Saw: a direct reference to ${REPORTS_DIR_SYMBOL}.`,
    'Wanted: a call to fleetReportPath / fleetReportDir / fleetReportAssetPath.',
    '',
    'Fix: import the helper from scripts/fleet/spend/report-path.mts. It',
    'owns the reports/<script>/index.html + assets/ layout, so a hand-joined path',
    'can put a file where no consumer looks for it.',
  )
  return lines.join('\n')
}

export async function main(): Promise<number> {
  const scan = await scanRepo(REPO_ROOT)
  if (isJsonRequested(process.argv)) {
    logger.log(JSON.stringify(scan, undefined, 2))
    return scan.findings.length === 0 ? 0 : 1
  }
  if (scan.findings.length > 0) {
    logger.fail(formatFailure(scan))
    return 1
  }
  if (!process.argv.includes('--quiet')) {
    logger.success(
      `Report paths are helper-built across ${scan.filesScanned} tracked script(s).`,
    )
  }
  return 0
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'checks every rendered-report path is built by the shared helper, not hand-joined',
  help: `Usage: node scripts/fleet/check/report-paths-are-helper-built.mts [flags]

  --json   emit the measurement as JSON instead of prose
  --quiet  suppress the pass message

The layout is reports/<script-name>/index.html plus assets/. Only the helper and
the paths module may name FLEET_REPORTS_DIR; every other caller asks the helper,
so a writer and a reader cannot disagree about where a report lives.`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
