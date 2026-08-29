#!/usr/bin/env node
/*
 * @file Gate: a collection literal is declared in exactly one file.
 *
 *   Two modules holding the same array of strings is the DRY violation
 *   docs/agents.md/fleet/single-source-of-truth.md forbids, and the copies do
 *   not stay equal: one gets the new entry, the other keeps shipping the old
 *   list, and a green gate hides the gap. `KINDS` lived in both
 *   check/claude-dirs-are-segmented.mts and the claude-segmentation-guard hook,
 *   each with its own copy of the same rationale comment; `DEPENDENCY_FIELDS`
 *   was five declarations under four names.
 *
 *   Detection is content-keyed, not name-keyed: the same entries under
 *   different names (`DEP_FIELDS` vs `DEPENDENCY_FIELDS` vs `DEP_SECTIONS`) is
 *   the same collection and the case most likely to drift, since a reader
 *   searching one name never finds the others.
 *
 *   Scoped to ONE tree. `template/base/` holds byte-identical mirrors of every
 *   live file, so scanning both would report every collection in the repo as a
 *   duplicate of itself.
 *
 *   Literals under MIN_ITEMS entries are skipped: three strings coincide by
 *   accident often enough that flagging them buries the real findings.
 *
 *   The burn-down in constants/collection-duplication-burn-down.json names the
 *   groups that predate the gate and only ever shrinks — an entry that no longer
 *   duplicates is reported as stale so the list cannot outlive the debt.
 *
 *   Usage: node scripts/fleet/check/collections-are-single-sourced.mts [--json]
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import { REPO_ROOT } from '../paths.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

/**
 * Below this, a shared list is as likely coincidence as duplication.
 */
export const MIN_ITEMS = 4

/**
 * Directory names never scanned: the mirror tree, build output, vendored code,
 * and the per-session worktrees.
 */
export const SKIP_DIRS: readonly string[] = [
  '.git',
  '_dist',
  'build',
  'coverage',
  'node_modules',
  'template',
  'upstream',
  'worktrees',
]

/**
 * One collection literal found in a source file.
 */
export interface CollectionDecl {
  readonly file: string
  readonly items: readonly string[]
  readonly name: string
}

// `const NAME = [ 'a', 'b' ]`, with an optional `export` and type annotation.
// Deliberately shallow: a literal spanning a nested structure is not the
// hand-maintained flat list this gate is about.
const COLLECTION_RE =
  /(?:export\s+)?const\s+([A-Z][A-Z\d_]*)\s*(?::[^=]*)?=\s*\[([^\]]*)\]/g
const STRING_RE = /'([^']+)'/g

/**
 * Every flat string-array constant in `source`. Pure.
 */
export function extractCollections(
  source: string,
  file: string,
): CollectionDecl[] {
  const out: CollectionDecl[] = []
  for (const match of source.matchAll(COLLECTION_RE)) {
    const items = [...match[2]!.matchAll(STRING_RE)].map(m => m[1]!)
    if (items.length >= MIN_ITEMS) {
      out.push({ file, items, name: match[1]! })
    }
  }
  return out
}

/**
 * The content key a collection groups by: deduped, sorted entries. Two lists
 * with the same key are the same collection whatever they are named.
 */
export function collectionKey(items: readonly string[]): string {
  return [...new Set(items)].toSorted().join('|')
}

/**
 * Groups of declarations sharing a content key across two or more FILES,
 * keyed by that content key. Sorted by key for a stable report. Pure.
 */
export function findDuplicateGroups(
  decls: readonly CollectionDecl[],
): Map<string, CollectionDecl[]> {
  const byKey = new Map<string, CollectionDecl[]>()
  for (let i = 0, { length } = decls; i < length; i += 1) {
    const decl = decls[i]!
    const key = collectionKey(decl.items)
    const bucket = byKey.get(key)
    if (bucket) {
      bucket.push(decl)
    } else {
      byKey.set(key, [decl])
    }
  }
  const out = new Map<string, CollectionDecl[]>()
  const keys = [...byKey.keys()].toSorted()
  for (let i = 0, { length } = keys; i < length; i += 1) {
    const key = keys[i]!
    const bucket = byKey.get(key)!
    if (new Set(bucket.map(d => d.file)).size >= 2) {
      out.set(key, bucket)
    }
  }
  return out
}

/**
 * Every `.mts` under `dir`, skipping SKIP_DIRS. Returns repo-relative paths.
 */
export function listSourceFiles(repoRoot: string, dir: string): string[] {
  const out: string[] = []
  const walk = (abs: string): void => {
    let entries: string[]
    try {
      entries = readdirSync(abs)
    } catch {
      return
    }
    for (let i = 0, { length } = entries; i < length; i += 1) {
      const entry = entries[i]!
      if (SKIP_DIRS.includes(entry)) {
        continue
      }
      const child = path.join(abs, entry)
      let isDir = false
      try {
        isDir = statSync(child).isDirectory()
      } catch {
        continue
      }
      if (isDir) {
        walk(child)
      } else if (entry.endsWith('.mts')) {
        out.push(path.relative(repoRoot, child))
      }
    }
  }
  walk(path.join(repoRoot, dir))
  return out.toSorted()
}

/**
 * A burn-down entry names the FILES a known group spans, sorted and joined, so
 * a group that gains a copy stops matching and is reported.
 */
export function groupSignature(decls: readonly CollectionDecl[]): string {
  return [...new Set(decls.map(d => d.file))].toSorted().join(' + ')
}

/**
 * The trees scanned. Both hold hand-maintained fleet source; `template/` is
 * excluded by SKIP_DIRS because it mirrors them byte for byte.
 */
export const SCANNED_TREES: readonly string[] = ['.claude/hooks', 'scripts']

const BURN_DOWN_PATH = path.join(
  'scripts',
  'fleet',
  'constants',
  'collection-duplication-burn-down.json',
)

/**
 * The known-duplicate signatures, or an empty set when the list is absent.
 */
export function readBurnDown(repoRoot: string): Set<string> {
  try {
    const parsed = JSON.parse(
      readFileSync(path.join(repoRoot, BURN_DOWN_PATH), 'utf8'),
    ) as { groups?: readonly string[] | undefined }
    return new Set(parsed.groups ?? [])
  } catch {
    return new Set()
  }
}

/**
 * Whether a burn-down signature describes files THIS repo carries.
 *
 * A signature is the group's files joined by ` + ` (see {@link groupSignature}).
 * An entry naming a path the member does not have is not applicable here: the
 * member never carried that duplication, so its absence is not debt paid.
 */
export interface IsApplicableSignatureOptions {
  /**
   * Repo the signature's files are resolved against. Defaults to this checkout.
   */
  repoRoot?: string | undefined
}

export function isApplicableSignature(
  signature: string,
  options?: IsApplicableSignatureOptions | undefined,
): boolean {
  const { repoRoot = REPO_ROOT } = {
    __proto__: null,
    ...options,
  } as IsApplicableSignatureOptions
  const files = signature
    .split(' + ')
    .map(part => part.trim())
    .filter(Boolean)
  if (files.length === 0) {
    return false
  }
  for (let i = 0, { length } = files; i < length; i += 1) {
    if (!existsSync(path.join(repoRoot, files[i]!))) {
      return false
    }
  }
  return true
}

function main(): number {
  const decls: CollectionDecl[] = []
  for (let i = 0, { length } = SCANNED_TREES; i < length; i += 1) {
    for (const rel of listSourceFiles(REPO_ROOT, SCANNED_TREES[i]!)) {
      try {
        decls.push(
          ...extractCollections(
            readFileSync(path.join(REPO_ROOT, rel), 'utf8'),
            rel,
          ),
        )
      } catch {
        // Unreadable source — the lint gate owns that failure.
      }
    }
  }
  const groups = findDuplicateGroups(decls)
  const burnDown = readBurnDown(REPO_ROOT)
  const fresh: CollectionDecl[][] = []
  const seen = new Set<string>()
  for (const bucket of groups.values()) {
    const signature = groupSignature(bucket)
    seen.add(signature)
    if (!burnDown.has(signature)) {
      fresh.push(bucket)
    }
  }
  // A burn-down entry whose group no longer duplicates is debt already paid;
  // report it so the list shrinks instead of outliving the problem.
  //
  // Applicable entries only. The list is FLEET-CANONICAL and cascaded, while the
  // duplication it records is per-repo, so a member that does not carry an
  // entry's files has not paid that debt - it never had it. Reporting those as
  // stale told every member to shrink a shared list on the wheelhouse's behalf,
  // and following that advice would delete an entry still holding real
  // duplication there.
  const stale = [...burnDown]
    .filter(sig => !seen.has(sig) && isApplicableSignature(sig))
    .toSorted()
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify({ fresh, stale }, undefined, 2)}\n`)
    return fresh.length === 0 ? 0 : 1
  }
  if (fresh.length === 0 && stale.length === 0) {
    logger.success(
      `[collections-are-single-sourced] every collection has one home (${groups.size} known duplicate group(s)).`,
    )
    return 0
  }
  for (let i = 0, { length } = fresh.length ? fresh : []; i < length; i += 1) {
    const bucket = fresh[i]!
    logger.fail(
      [
        `[collections-are-single-sourced] the same ${bucket[0]!.items.length}-entry list is declared in ${new Set(bucket.map(d => d.file)).size} files:`,
        ...bucket.map(d => `    ${d.name} — ${d.file}`),
        '  Copies drift: one gains the new entry, the other keeps shipping the old',
        '  list. Move it to ONE module and import it',
        '  (docs/agents.md/fleet/single-source-of-truth.md), or add the signature',
        `  to ${BURN_DOWN_PATH} with the reason it stands.`,
      ].join('\n'),
    )
  }
  for (let i = 0, { length } = stale.length ? stale : []; i < length; i += 1) {
    logger.fail(
      `[collections-are-single-sourced] burn-down entry no longer duplicates: ${stale[i]!}\n` +
        `  Remove it from ${BURN_DOWN_PATH} — the list only shrinks.`,
    )
  }
  return 1
}

const SCRIPT_META: ScriptMeta = {
  describe: 'checks that a collection literal is declared in exactly one file',
  help: 'Usage: node scripts/fleet/check/collections-are-single-sourced.mts [--json]',
}

if (isMainModule(import.meta.url)) {
  runMain(() => {
    process.exitCode = main()
  }, SCRIPT_META)
}
