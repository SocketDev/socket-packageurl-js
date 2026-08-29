#!/usr/bin/env node
/**
 * @file Fleet check - every `.claude/settings.json` brackets its fleet-owned
 *   region with the short marker keys `// <fleet>` and `// </fleet>`. The
 *   settings merger looks that pair up by exact string, so a file emitting any
 *   other spelling has no region the merger can find: hydration refuses the
 *   pack with "missing or misordered markers. Nothing written." and the member
 *   silently stops receiving fleet settings. SCOPE - this gate reads parsed
 *   JSON KEYS and nothing else. `fleet-canonical` is also the block-tag name in
 *   the named-block grammar (`<!-- <fleet-canonical id="standards"> -->` in a
 *   CLAUDE.md, `# <fleet…>` in an ignore file). Those are a separate marker
 *   family with their own parser and their own spelling, so widening this check
 *   to a text search over file bytes would flag correct files. Match the key,
 *   never the bytes. Usage: node
 *   scripts/fleet/check/claude-settings-fleet-markers-are-short.mts [--json]
 *   [--quiet].
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { REPO_ROOT } from '../paths.mts'
import { collectTrackedFiles } from '../_shared/tracked-globs.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { isJsonRequested, runMain } from '../_shared/run-main.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

export const FLEET_REGION_BEGIN = '// <fleet>'
export const FLEET_REGION_END = '// </fleet>'

const SETTINGS_SUFFIX = '.claude/settings.json'
// Longest first: a close tag also starts with the open tag's prefix.
const CLOSE_PREFIX = '// </'
const OPEN_PREFIX = '// <'

export interface MarkerFinding {
  readonly file: string
  readonly key: string
}

/**
 * Whether a JSON key is bracketing a fleet region, whatever its spelling. The
 * tag name decides it, so `// <fleet>`, `// </fleet-canonical>`, and an
 * attribute-carrying `// <fleet-canonical id="standards">` are all region keys,
 * while `// <fleetwide>` and the plain `// statusLine` comment key are not.
 *
 * Attributes count deliberately. A key the merger cannot resolve is a defect
 * whether or not it carries them, and reading the tag name uniformly is what
 * keeps this from answering differently for two keys of the same shape.
 *
 * Written with string operations rather than a pattern: expressing the
 * qualifier-plus-attributes shape as a regex takes a nested quantifier, which
 * is a backtracking hazard on a key read from a file.
 */
export function isRegionKey(key: string): boolean {
  if (!key.endsWith('>')) {
    return false
  }
  let rest: string
  if (key.startsWith(CLOSE_PREFIX)) {
    rest = key.slice(CLOSE_PREFIX.length)
  } else if (key.startsWith(OPEN_PREFIX)) {
    rest = key.slice(OPEN_PREFIX.length)
  } else {
    return false
  }
  // The tag name runs to the first space, or to the closing bracket when the
  // tag carries no attributes.
  const inner = rest.slice(0, -1)
  const space = inner.indexOf(' ')
  const tag = space === -1 ? inner : inner.slice(0, space)
  return tag === 'fleet' || tag.startsWith('fleet-')
}

/**
 * Region keys that are not the short pair. Empty means the file is compliant.
 */
export function longFormKeys(settings: unknown): string[] {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return []
  }
  return Object.keys(settings).filter(
    key =>
      isRegionKey(key) &&
      key !== FLEET_REGION_BEGIN &&
      key !== FLEET_REGION_END,
  )
}

/**
 * Tracked `.claude/settings.json` paths, repo-relative and slash-separated.
 */
export async function settingsFiles(repoRoot: string): Promise<string[]> {
  const tracked = await collectTrackedFiles(['**/settings.json'], {
    cwd: repoRoot,
    dot: true,
    expectMatches: true,
  })
  return tracked
    .map(normalizePath)
    .filter(file => file.endsWith(SETTINGS_SUFFIX))
}

/**
 * Scan one settings file. A file that is not parseable JSON is not this check's
 * concern - the JSON gate owns that - so it contributes no findings.
 */
export function scanSettingsFile(
  repoRoot: string,
  file: string,
): MarkerFinding[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path.join(repoRoot, file), 'utf8'))
  } catch {
    return []
  }
  return longFormKeys(parsed).map(key => ({ file, key }))
}

export interface MarkerScan {
  readonly filesScanned: number
  readonly findings: MarkerFinding[]
}

export async function scanRepo(repoRoot: string): Promise<MarkerScan> {
  const files = await settingsFiles(repoRoot)
  const findings: MarkerFinding[] = []
  for (let i = 0, { length } = files; i < length; i += 1) {
    findings.push(...scanSettingsFile(repoRoot, files[i]!))
  }
  return { filesScanned: files.length, findings }
}

export function formatFailure(scan: MarkerScan): string {
  const lines = [
    'A .claude/settings.json brackets its fleet region with a retired marker key.',
    '',
  ]
  for (const finding of scan.findings) {
    lines.push(`  ${finding.file}: ${finding.key}`)
  }
  lines.push(
    '',
    `Wanted the short pair: ${FLEET_REGION_BEGIN} … ${FLEET_REGION_END}`,
    'The merger looks these keys up by exact string, so a long-form key leaves it',
    'with no region to merge and hydration writes nothing.',
    '',
    'Fix: rename the two keys in the file named above. If that file is a cascaded',
    'mirror, rename them in template/base and re-run the cascade instead.',
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
      `Claude settings fleet markers are short in ${scan.filesScanned} tracked settings file(s).`,
    )
  }
  return 0
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'checks every .claude/settings.json brackets its fleet region with the short marker keys',
  help: `Usage: node scripts/fleet/check/claude-settings-fleet-markers-are-short.mts [flags]

  --json   emit the measurement as JSON instead of prose
  --quiet  suppress the pass message

Matches parsed JSON keys only. The named-block grammar uses the same word as a
block TAG in CLAUDE.md and ignore files; that is a separate family and is
deliberately out of scope.`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
