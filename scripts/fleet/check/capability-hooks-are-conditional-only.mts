#!/usr/bin/env node
/**
 * @file Placement gate for capability-gated hooks. A hook carrying an
 *   `@capability <name>` header must live under `template/conditional/<name>/`,
 *   never `template/base/`: the fleet-pack bundle walks template/base with NO
 *   capability filter (collectBundleFiles), and installFleet places every
 *   manifest file verbatim, so a gated hook placed in base ships to every
 *   member, gated or not — the concurrent-cargo-build-guard incident class,
 *   where a Rust-only hook landed in plain-JS repos. The dir-mirror skip
 *   predicate honors the header only during cascade composition; nothing else
 *   enforces the placement. This scan is the backstop: any `@capability`
 *   marker under the base hooks tree fails, naming the hook and the
 *   conditional layer it belongs in. Member repos carry no template/ tree and
 *   skip silently — the gate only has teeth at the template source.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

/**
 * The header form the dir-mirror copy filter keys on.
 */
const CAPABILITY_MARKER_RE = /@capability\s+(\S+)/

/**
 * Every `@capability`-marked hook under a template hooks dir, as
 * `{ hook, capability }` pairs. Reads `index.mts` headers only — the marker
 * is a first-lines comment by convention, and a hook without an index is not
 * a hook. Pure, exported for tests.
 */
export function findMisplacedCapabilityHooks(
  hooksDir: string,
): Array<{ capability: string; hook: string }> {
  const found: Array<{ capability: string; hook: string }> = []
  if (!existsSync(hooksDir)) {
    return found
  }
  for (const entry of readdirSync(hooksDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue
    }
    const indexPath = path.join(hooksDir, entry.name, 'index.mts')
    if (!existsSync(indexPath)) {
      continue
    }
    const head = readFileSync(indexPath, 'utf8').slice(0, 2000)
    const match = CAPABILITY_MARKER_RE.exec(head)
    if (match?.[1] !== undefined) {
      found.push({ capability: match[1], hook: entry.name })
    }
  }
  return found.toSorted((a, b) => a.hook.localeCompare(b.hook))
}

export async function main(): Promise<void> {
  const quiet = process.argv.includes('--quiet')
  const hooksDir = path.join(
    REPO_ROOT,
    'template',
    'base',
    '.claude',
    'hooks',
    'fleet',
  )
  if (!existsSync(hooksDir)) {
    // A member repo has no template tree — placement is enforced at the
    // source (the wheelhouse), where this check cascades from.
    if (!quiet) {
      logger.log(
        'capability-hooks-are-conditional-only: no template tree here; skipping.',
      )
    }
    return
  }
  const found = findMisplacedCapabilityHooks(hooksDir)
  if (found.length === 0) {
    if (!quiet) {
      logger.success(
        'capability-hooks-are-conditional-only: no @capability hooks under template/base.',
      )
    }
    return
  }
  logger.fail(
    [
      `capability-hooks-are-conditional-only: ${found.length} @capability hook(s) live under template/base, where the bundle ships them to EVERY member:`,
      ...found.map(
        f =>
          `  ${f.hook} — belongs under template/conditional/${f.capability}/`,
      ),
      'The fleet-pack bundle applies no capability filter; gated hooks must',
      'live in a conditional layer or every member receives them.',
    ].join('\n'),
  )
  process.exitCode = 1
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'fails when an @capability-marked hook lives under template/base, where the bundle ships it to every member',
  help: 'Move the named hook directory from template/base/.claude/hooks/fleet/ to template/conditional/<capability>/.claude/hooks/fleet/, then re-run this check.',
}

if (isMainModule(import.meta.url)) {
  void runMain(main, SCRIPT_META)
}
