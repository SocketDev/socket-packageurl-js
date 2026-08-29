#!/usr/bin/env node
/**
 * @file Asserts a lockfile regeneration did not drop a workspace importer that
 *   belongs to the fleet payload. A thin member does not track its fleet hooks:
 *   the bundle fetches them, and `.gitignore` keeps the tree clean. Each hook
 *   is still its own workspace package, so `pnpm-lock.yaml` carries an importer
 *   entry for it. Run `pnpm install` in a checkout whose payload is NOT
 *   hydrated and pnpm sees no directory, so it drops the importer and the
 *   deletion looks like a tidy-up. It is not. CI hydrates the payload before
 *   installing, finds the `package.json` the lockfile no longer mentions, and
 *   dies with `ERR_PNPM_OUTDATED_LOCKFILE` in every job. The local tree cannot
 *   reproduce it, because locally the directory really is absent. The
 *   authoritative signal is the bundle's own applied-files record
 *   (`.cache/fleet/socket-wheelhouse/applied-files`), which lists every path
 *   the last apply placed. An importer whose `package.json` appears there is
 *   fleet payload, and its entry must survive. That distinguishes a
 *   not-yet-hydrated hook from one genuinely retired from the fleet, which disk
 *   absence alone cannot. KNOWN LIMIT, and do not "fix" it the obvious way:
 *   this compares the working lockfile against the COMMITTED one, so it catches
 *   a drop before it lands and NOT one that already did. The tempting absolute
 *   rule — every bundle-placed package.json owes an importer — is unsound,
 *   measured: pnpm omits the importer for a workspace package with no
 *   dependencies, and 116 payload packages in one member have none, so that
 *   rule reported 116 findings against a lockfile that was completely correct.
 *   Making it sound needs each payload package's dependency count, which is
 *   unreadable in the very state this gate fires in (the payload is not on
 *   disk). A pre-push run on the member is what covers the committed case.
 *   Exit: 0 — no payload importer was dropped, or there is no committed
 *   lockfile / no applied-files record to judge against. 1 — at least one was.
 *   Usage: `node scripts/fleet/check/payload-importers-are-preserved.mts`
 *   reports; `--fix` restores the committed lockfile, and only when every
 *   dropped importer is payload-owned.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { gitSync } from '../_shared/git-exec.mts'

import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import type { ScriptMeta } from '../_shared/run-main.mts'
import { REPO_ROOT } from '../paths.mts'

const SCRIPT_META: ScriptMeta = {
  describe:
    'checks a lockfile regeneration did not drop a fleet-payload workspace importer',
  help: `Usage: node scripts/fleet/check/payload-importers-are-preserved.mts [flags]

  --fix  restore the committed lockfile when every dropped importer is payload-owned`,
}

const LOCKFILE = 'pnpm-lock.yaml'
const APPLIED_FILES = '.cache/fleet/socket-wheelhouse/applied-files'

/**
 * Importer keys in a pnpm lockfile: the top-level `importers:` block's
 * two-space-indented keys. Parsed by shape rather than with a YAML loader so
 * this check stays dependency-free and cannot fail on a lockfile version bump
 * it does not understand.
 */
export function parseImporterKeys(lockfileText: string): Set<string> {
  const keys = new Set<string>()
  const lines = lockfileText.split(/\r?\n/)
  let inImporters = false
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (/^importers:\s*$/.test(line)) {
      inImporters = true
      continue
    }
    if (!inImporters) {
      continue
    }
    // A new top-level key ends THIS importers block. Keep scanning rather than
    // stopping: pnpm writes the lockfile as multiple YAML documents, so a
    // second `importers:` follows later and holds the workspace packages. A
    // parser that stopped at the first block saw one importer out of hundreds.
    if (/^\S/.test(line)) {
      inImporters = false
      continue
    }
    const m = /^ {2}(\S.*?):\s*$/.exec(line)
    if (m) {
      // A leading OR a trailing single/double quote. pnpm quotes an importer
      // key only where YAML needs it, so both forms arrive here.
      keys.add(normalizePath(m[1]!.replace(/^['"]|['"]$/g, '')))
    }
  }
  return keys
}

/**
 * Every repo-relative path the last bundle apply placed, or undefined when no
 * record exists. Undefined means "cannot judge", which this check treats as a
 * clean pass rather than a failure.
 */
export function readAppliedPaths(
  repoRoot: string = REPO_ROOT,
): Set<string> | undefined {
  const p = path.join(repoRoot, APPLIED_FILES)
  if (!existsSync(p)) {
    return undefined
  }
  const out = new Set<string>()
  const lines = readFileSync(p, 'utf8').split(/\r?\n/)
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const trimmed = lines[i]!.trim()
    if (trimmed) {
      out.add(normalizePath(trimmed))
    }
  }
  return out
}

/**
 * The committed lockfile text, or undefined when git cannot produce it (no
 * commit yet, no git, a fresh archive export).
 */
export function readCommittedLockfile(
  repoRoot: string = REPO_ROOT,
): string | undefined {
  const r = gitSync(['show', `HEAD:${LOCKFILE}`], {
    cwd: repoRoot,
  })
  if (r.status !== 0) {
    return undefined
  }
  const text = String(r.stdout ?? '')
  return text === '' ? undefined : text
}

/**
 * Importers the working lockfile dropped whose `package.json` the bundle owns.
 * Pure over its inputs, so the whole rule unit-tests without git or a bundle.
 */
export function droppedPayloadImporters(
  committedKeys: ReadonlySet<string>,
  workingKeys: ReadonlySet<string>,
  appliedPaths: ReadonlySet<string>,
): string[] {
  const dropped: string[] = []
  for (const key of committedKeys) {
    if (workingKeys.has(key)) {
      continue
    }
    if (appliedPaths.has(normalizePath(path.posix.join(key, 'package.json')))) {
      dropped.push(key)
    }
  }
  return dropped.toSorted()
}

export function main(): number {
  const logger = getDefaultLogger()
  const fix = process.argv.includes('--fix')
  const workingPath = path.join(REPO_ROOT, LOCKFILE)
  if (!existsSync(workingPath)) {
    logger.success('payload-importers-are-preserved: no lockfile to judge.')
    return 0
  }
  const committed = readCommittedLockfile()
  const applied = readAppliedPaths()
  if (committed === undefined || applied === undefined) {
    logger.success(
      'payload-importers-are-preserved: no committed lockfile or applied-files record — nothing to compare.',
    )
    return 0
  }
  const workingText = readFileSync(workingPath, 'utf8')
  const dropped = droppedPayloadImporters(
    parseImporterKeys(committed),
    parseImporterKeys(workingText),
    applied,
  )
  if (dropped.length === 0) {
    logger.success(
      'payload-importers-are-preserved: every fleet-payload importer survived.',
    )
    return 0
  }
  if (fix) {
    writeFileSync(workingPath, committed)
    logger.success(
      `payload-importers-are-preserved: restored the committed ${LOCKFILE}, ${dropped.length} payload importer(s) were dropped.`,
    )
    return 0
  }
  logger.error(
    `payload-importers-are-preserved: ${dropped.length} fleet-payload importer(s) dropped from ${LOCKFILE}.`,
  )
  logger.error(`  Where: ${LOCKFILE}, versus the committed copy.`)
  logger.error(
    '  Saw:   an importer removed whose package.json the bundle places; wanted: it kept.',
  )
  logger.error(
    '  Why:   the payload is not hydrated here, so pnpm saw no directory and dropped the entry. CI hydrates first, finds the manifest, and fails every job with ERR_PNPM_OUTDATED_LOCKFILE.',
  )
  for (let i = 0, { length } = dropped; i < length; i += 1) {
    logger.error(`    • ${dropped[i]!}`)
  }
  logger.error(
    `  Fix:   re-run with --fix to restore the committed lockfile, or hydrate the payload (node scripts/repo/bootstrap/fleet.mjs) and install again.`,
  )
  return 1
}

/* c8 ignore start - CLI entry, exercised by the integration spec. */
if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
/* c8 ignore stop */
