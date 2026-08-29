#!/usr/bin/env node
/*
 * @file Fleet check: every hook block message keeps the quiet-guards contract.
 *   At most 3 content lines plus an optional trailing bypass line, the first
 *   line opening `<hook-name>: <what> - <why>`, one `Fix:` line naming the
 *   action, and no blank-line padding, no indented prose paragraph, no
 *   multi-command tutorial, no em-dash.
 *
 *   Why this is a gate rather than a review note: the verbose shape was the
 *   fleet default for a long time, so it is what a new hook gets copied from.
 *   A hand sweep cleared 68 hooks and every one of them was found by reading
 *   source, which is exactly the read a script can do on every commit.
 *
 *   Scope, and the reason it is not simply "every hook on disk": a fleet hook
 *   under `.claude/hooks/fleet/` is a cascaded mirror, so gating it would
 *   report a finding whose fix lives in another file. The gate reads
 *   `template/base/.claude/hooks/**` where that tree exists, which is the
 *   wheelhouse, and the live tree where it does not, which is every member. A
 *   repo-tier hook is host-owned wherever it lives, so it always gates from the
 *   live tree.
 *
 *   The analyzer is `scripts/fleet/_shared/guard-block-shape.mts`. This file
 *   owns the walk and the verdict.
 *
 *   Usage: node scripts/fleet/check/guard-blocks-are-pithy.mts [--json] [--quiet]
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { REPO_ROOT } from '../paths.mts'
import {
  renderGuardBlockFinding,
  scanGuardBlocks,
} from '../_shared/guard-block-shape.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { collectTrackedFiles } from '../_shared/tracked-globs.mts'
import { isJsonRequested, runMain } from '../_shared/run-main.mts'

import type { GuardBlockFinding } from '../_shared/guard-block-shape.mts'
import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

const TEMPLATE_HOOKS_ROOT = 'template/base/.claude/hooks'

export interface GuardBlockFileFinding extends GuardBlockFinding {
  readonly file: string
}

export interface GuardBlockScan {
  readonly filesScanned: number
  readonly findings: GuardBlockFileFinding[]
}

/**
 * The hook `index.mts` files this repo owns the source of.
 *
 * A wheelhouse holds the fleet hooks under `template/base`, so the live copies
 * are outputs and gating them would name a file whose fix is elsewhere. A
 * member has no template tree, so its live fleet hooks are the only copy it can
 * read. Repo-tier hooks are host-owned either way.
 */
export async function hookSourceFiles(repoRoot: string): Promise<string[]> {
  const hasTemplate = existsSync(path.join(repoRoot, TEMPLATE_HOOKS_ROOT))
  const patterns = hasTemplate
    ? [`${TEMPLATE_HOOKS_ROOT}/*/*/index.mts`, '.claude/hooks/repo/*/index.mts']
    : ['.claude/hooks/*/*/index.mts']
  const files = await collectTrackedFiles(patterns, {
    cwd: repoRoot,
    dot: true,
  })
  return files.map(normalizePath).toSorted()
}

/**
 * The hook's own name, which is the directory holding its `index.mts`.
 */
export function hookNameOf(file: string): string {
  const segments = normalizePath(file).split('/')
  return segments[segments.length - 2] ?? ''
}

export function scanHookFile(
  repoRoot: string,
  file: string,
): GuardBlockFileFinding[] {
  let source: string
  try {
    source = readFileSync(path.join(repoRoot, file), 'utf8')
  } catch {
    return []
  }
  return scanGuardBlocks(source, hookNameOf(file)).map(finding => ({
    ...finding,
    file,
  }))
}

export async function scanRepo(repoRoot: string): Promise<GuardBlockScan> {
  const files = await hookSourceFiles(repoRoot)
  const findings: GuardBlockFileFinding[] = []
  for (let i = 0, { length } = files; i < length; i += 1) {
    findings.push(...scanHookFile(repoRoot, files[i]!))
  }
  return { filesScanned: files.length, findings }
}

export function formatFailure(scan: GuardBlockScan): string {
  const lines = [
    `${scan.findings.length} hook block message(s) break the quiet-guards contract.`,
    '',
  ]
  for (const finding of scan.findings) {
    lines.push(`  ${renderGuardBlockFinding(finding.file, finding)}`)
  }
  lines.push(
    '',
    'Wanted, per block: `<hook-name>: <what> - <why>`, an optional `Saw:` or',
    '`Where:` line, and a closing `Fix:` line naming one command.',
    '',
    'Fix: rewrite the block named above to 3 lines or fewer, dropping the empty',
    'string spacers and the tutorial, and keep any bypass line as its own trailing',
    'line.',
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
      `Guard blocks are pithy in ${scan.filesScanned} hook source file(s).`,
    )
  }
  return 0
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'checks every hook block message keeps the quiet-guards shape: 3 lines or fewer, named hook, one Fix line',
  help: `Usage: node scripts/fleet/check/guard-blocks-are-pithy.mts [flags]

  --json   emit the measurement as JSON instead of prose
  --quiet  suppress the pass message

Reads the hook sources this repo owns: template/base/.claude/hooks in the
wheelhouse, the live .claude/hooks tree in a member. A cascaded mirror is never
gated, since its fix lives at the template source.`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
