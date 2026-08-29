#!/usr/bin/env node
/*
 * @file Gate: a soak exclusion's SHAPE must match who publishes the package.
 *
 *   `minimumReleaseAgeExclude` carries two kinds of entry, and the difference
 *   is not cosmetic:
 *
 *   - **Versionless** (`'@socketsecurity/lib'`, `'@socketbin/*'`) is a STANDING
 *     exemption covering every release, forever. That is only sound for a
 *     Socket-published package, which ships through Socket's own provenance and
 *     publish pipeline: soaking it only delays the fleet behind itself.
 *   - **Versioned** (`'some-tool@0.18.1'`) admits exactly ONE release. That is
 *     the shape a third-party package must use, so the NEXT release of it is
 *     not silently admitted the moment it is published.
 *
 *   Get the shape wrong in either direction and the entry means something other
 *   than what it looks like. A versionless third-party entry is a permanent
 *   soak bypass for a publisher nobody vetted, which is precisely the malware
 *   window the soak exists to close. A versioned Socket entry is the harmless
 *   mistake, but it still means a new entry per release and a stale one left
 *   behind each time.
 *
 *   `isSocketSourcedPackage` from `constants/socket-scopes.mts` is the single
 *   source of truth for who published a package; this check derives, never
 *   maintains its own list.
 *
 *   Adjacent enforcement, all orthogonal: `soak-exclude-scope-guard` restricts
 *   which packages may appear at all at edit time, `soak-exclude-date-guard`
 *   requires the `published`/`removable` annotation, and
 *   `soak-excludes-have-dates` audits those annotations at commit time. None of
 *   them reads the version shape.
 *
 *   Exit codes: 0 — every entry's shape matches its publisher; 1 — at least one
 *   mismatch.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { isSocketSourcedPackage } from '../constants/socket-scopes.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import { REPO_ROOT } from '../paths.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

const WORKSPACE_FILE = 'pnpm-workspace.yaml'

const SECTION_HEADER = /^minimumReleaseAgeExclude:\s*$/
const ANY_TOP_LEVEL_KEY = /^[A-Za-z_][\w-]*:\s*(?:\S.*)?$/
const ENTRY_RE = /^\s*-\s*['"]?(?<entry>[^'"\s]+)['"]?\s*$/

/**
 * Every entry under `minimumReleaseAgeExclude:`, keyed by entry to its
 * 1-indexed line. Mirrors the edit-time guard's reader so both agree on what
 * counts as an entry.
 */
export function parseExcludeEntries(text: string): Map<string, number> {
  const found = new Map<string, number>()
  const lines = text.split(/\r?\n/)
  let inBlock = false
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i] ?? ''
    if (SECTION_HEADER.test(line)) {
      inBlock = true
      continue
    }
    if (!inBlock) {
      continue
    }
    if (ANY_TOP_LEVEL_KEY.test(line)) {
      inBlock = false
      continue
    }
    const matched = ENTRY_RE.exec(line)
    if (matched) {
      found.set(matched.groups!['entry']!, i + 1)
    }
  }
  return found
}

/**
 * Split an entry into its package name and version, if it pins one.
 *
 * The leading `@` of a scoped name is not a version separator, so the split
 * looks for an `@` after position 0. A glob (`@scope/*`) pins nothing.
 */
export function splitEntry(entry: string): {
  name: string
  version: string | undefined
} {
  const at = entry.lastIndexOf('@')
  if (at <= 0) {
    return { name: entry, version: undefined }
  }
  const version = entry.slice(at + 1)
  // A trailing `@` with nothing after it, or a scope-only `@scope/name` whose
  // last `@` IS the leading one, pins no version.
  if (!version || version.includes('/')) {
    return { name: entry, version: undefined }
  }
  return { name: entry.slice(0, at), version }
}

export interface TrustMismatch {
  readonly entry: string
  readonly line: number
  readonly reason: 'third-party-needs-version' | 'socket-should-be-versionless'
}

/**
 * Entries whose shape contradicts their publisher.
 *
 * A glob is treated as versionless, which is what it is: it covers every
 * release of every package under the scope.
 */
export function findTrustMismatches(
  entries: ReadonlyMap<string, number>,
): TrustMismatch[] {
  const out: TrustMismatch[] = []
  for (const [entry, line] of entries) {
    const { name, version } = splitEntry(entry)
    const isSocket = isSocketSourcedPackage(name)
    if (!isSocket && version === undefined) {
      out.push({ entry, line, reason: 'third-party-needs-version' })
      continue
    }
    if (isSocket && version !== undefined) {
      out.push({ entry, line, reason: 'socket-should-be-versionless' })
    }
  }
  return out.toSorted((a, b) => a.line - b.line)
}

export function describeMismatch(mismatch: TrustMismatch): string {
  return mismatch.reason === 'third-party-needs-version'
    ? `${WORKSPACE_FILE}:${mismatch.line} '${mismatch.entry}' is third-party and versionless — a standing soak bypass for a publisher nobody vetted. Pin it: '${mismatch.entry}@<version>'.`
    : `${WORKSPACE_FILE}:${mismatch.line} '${mismatch.entry}' is Socket-published and version-pinned — drop the version so the exemption covers the whole trusted line instead of needing a new entry per release.`
}

export async function main(): Promise<void> {
  const isQuiet = process.argv.includes('--quiet')
  const file = path.join(REPO_ROOT, WORKSPACE_FILE)
  if (!existsSync(file)) {
    return
  }
  const entries = parseExcludeEntries(readFileSync(file, 'utf8'))
  const mismatches = findTrustMismatches(entries)
  if (mismatches.length) {
    logger.fail(
      `[soak-excludes-match-package-trust] ${mismatches.length} exclusion(s) whose shape contradicts the publisher.`,
    )
    logger.group()
    for (const mismatch of mismatches) {
      logger.error(describeMismatch(mismatch))
    }
    logger.error(
      'Versionless means Socket-published, so the standing exemption is sound. Versioned means third-party, so exactly one reviewed release is admitted and the next one is not.',
    )
    logger.groupEnd()
    process.exitCode = 1
    return
  }
  if (!isQuiet) {
    logger.log(
      `[soak-excludes-match-package-trust] ok — ${entries.size} exclusion(s), every shape matches its publisher`,
    )
  }
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'checks a soak exclusion is versionless only for a Socket-published package, and version-pinned for a third-party one',
  help: `Usage: node scripts/fleet/check/soak-excludes-match-package-trust.mts [flags]

  --quiet  silent on clean`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
