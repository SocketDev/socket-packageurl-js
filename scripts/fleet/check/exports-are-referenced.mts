#!/usr/bin/env node
/*
 * @file `check --all` gate: an exported symbol is referenced somewhere.
 *
 *   TypeScript's `noUnusedLocals` covers locals and imports — it caught the two
 *   dead type imports left behind when the aliases using them went — but it
 *   cannot flag an unused EXPORT, because an export is by definition reachable
 *   from outside the program. So dead exports accumulate silently: a helper
 *   whose last caller was refactored away, a `FOO` superseded by a `FOOS`
 *   sitting right below it, a type alias that is only a second name for another
 *   type.
 *
 *   The rule is deliberately the narrowest one that CANNOT be wrong: a symbol
 *   declared in exactly one module, whose name occurs exactly once across every
 *   tracked text file, is provably referenced by nothing. One occurrence is the
 *   declaration itself.
 *
 *   That under-reports on purpose. A symbol declared in both a template source
 *   and its cascaded live mirror occurs twice before anything uses it, and one
 *   used only inside its own module occurs twice as well, so neither is
 *   reported. Widening past that means guessing which occurrence is a
 *   declaration and which is a use, and a name-frequency heuristic cannot tell
 *   them apart — measured on this repo, loosening the rule moved the count from
 *   6 to 899 with no way to tell which were real. A gate that cries wolf gets
 *   ignored, so this one only speaks when it is certain.
 *
 *   Counting is over TRACKED files of every text kind, not just `.mts`: a name
 *   cited in a doc, a manifest or a generated config is in use.
 *
 *   Usage: node scripts/fleet/check/exports-are-referenced.mts [--json]
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { gitSync } from '../_shared/git-exec.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import { REPO_ROOT } from '../paths.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

/**
 * Text kinds a symbol name can legitimately be referenced from.
 */
export const SCANNED_EXTENSIONS: readonly string[] = [
  '.cjs',
  '.js',
  '.json',
  '.jsonc',
  '.md',
  '.mjs',
  '.mts',
  '.ts',
  '.yaml',
  '.yml',
]

/**
 * Trees whose exports this gate owns. Source authored here, not vendored or
 * generated.
 */
export const DECLARING_PREFIXES: readonly string[] = [
  '.claude/hooks/',
  'scripts/',
]

/**
 * Paths excluded from BOTH the declaration scan and the reference count: build
 * output and vendored code, where a name's presence proves nothing.
 */
export const EXCLUDED_SEGMENTS: readonly string[] = [
  '_dist/',
  'node_modules/',
  'template/generated/',
  'upstream/',
]

// A top-level export declaration, capturing the declared name:
//   ^export        - column zero only, so a re-export inside a block is skipped
//   (?:async\s+)?  - an async function declaration
//   class|const|function|interface|type - the declaration kinds worth checking
//   ([A-Za-z_]\w*) - the name, which is what the reference scan looks for
// Flags: g (every match), m (^ per line), u (unicode).
const EXPORT_RE =
  /^export\s+(?:async\s+)?(?:class|const|function|interface|type)\s+([A-Za-z_]\w*)/gmu
const IDENTIFIER_RE = /[A-Za-z_]\w*/gu

export interface DeadExport {
  readonly file: string
  readonly name: string
}

/**
 * True when `file` is out of scope for scanning entirely.
 */
export function isExcluded(file: string): boolean {
  // `git ls-files` already reports POSIX separators, but normalizing keeps the
  // segment comparison honest for any caller passing a native path.
  const normalized = normalizePath(file)
  for (let i = 0, { length } = EXCLUDED_SEGMENTS; i < length; i += 1) {
    const segment = EXCLUDED_SEGMENTS[i]!
    // Matched at the START of the path as well as mid-path. A leading-slash
    // form misses a top-level directory: `upstream/x.mts` never contains
    // `/upstream/`, so a whole vendored tree read as in-scope.
    if (normalized.startsWith(segment) || normalized.includes(`/${segment}`)) {
      return true
    }
  }
  return false
}

/**
 * True when `file` is a tree whose exports this gate judges.
 */
export function declaresExports(file: string): boolean {
  if (!file.endsWith('.mts') || isExcluded(file)) {
    return false
  }
  for (let i = 0, { length } = DECLARING_PREFIXES; i < length; i += 1) {
    if (file.startsWith(DECLARING_PREFIXES[i]!)) {
      return true
    }
  }
  return false
}

/**
 * Every top-level exported symbol name in `source`, in declaration order.
 * Pure.
 */
export function exportedNames(source: string): string[] {
  const out: string[] = []
  for (const match of source.matchAll(EXPORT_RE)) {
    out.push(match[1]!)
  }
  return out
}

/**
 * Every identifier in `source`, counted. Pure.
 */
export function countIdentifiers(
  source: string,
  into: Map<string, number>,
): void {
  for (const match of source.matchAll(IDENTIFIER_RE)) {
    const name = match[0]
    into.set(name, (into.get(name) ?? 0) + 1)
  }
}

/**
 * The exports nothing references: declared in exactly one file, and occurring
 * exactly once across everything scanned. Pure over the two tallies, so the
 * rule is testable without a repo walk.
 */
export function findDeadExports(
  declarations: ReadonlyMap<string, readonly string[]>,
  occurrences: ReadonlyMap<string, number>,
): DeadExport[] {
  const out: DeadExport[] = []
  for (const [name, files] of declarations) {
    if (files.length !== 1) {
      continue
    }
    if ((occurrences.get(name) ?? 0) <= 1) {
      out.push({ file: files[0]!, name })
    }
  }
  return out.toSorted((a, b) =>
    a.file === b.file
      ? a.name.localeCompare(b.name)
      : a.file.localeCompare(b.file),
  )
}

/**
 * The tracked files worth reading, repo-relative.
 */
export function trackedTextFiles(repoRoot: string): string[] {
  const listed = gitSync(['ls-files'], {
    cwd: repoRoot,
    stdioString: true,
  })
  const out: string[] = []
  const lines = String(listed.stdout ?? '').split(/\r?\n/)
  for (let l = 0, { length: linesLength } = lines; l < linesLength; l += 1) {
    const file = lines[l]!.trim()
    if (!file || isExcluded(file)) {
      continue
    }
    for (
      let i = 0, { length: extCount } = SCANNED_EXTENSIONS;
      i < extCount;
      i += 1
    ) {
      if (file.endsWith(SCANNED_EXTENSIONS[i]!)) {
        out.push(file)
        break
      }
    }
  }
  return out
}

function scanRepo(repoRoot: string): DeadExport[] {
  const declarations = new Map<string, string[]>()
  const occurrences = new Map<string, number>()
  for (const file of trackedTextFiles(repoRoot)) {
    let source: string
    try {
      source = readFileSync(path.join(repoRoot, file), 'utf8')
    } catch {
      // Unreadable file — the lint gate owns that failure.
      continue
    }
    countIdentifiers(source, occurrences)
    if (!declaresExports(file)) {
      continue
    }
    for (const name of exportedNames(source)) {
      const seen = declarations.get(name)
      if (seen) {
        seen.push(file)
      } else {
        declarations.set(name, [file])
      }
    }
  }
  return findDeadExports(declarations, occurrences)
}

function main(): number {
  const dead = scanRepo(REPO_ROOT)
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify({ dead }, undefined, 2)}\n`)
    return dead.length === 0 ? 0 : 1
  }
  if (dead.length === 0) {
    logger.success('[exports-are-referenced] every export is referenced.')
    return 0
  }
  logger.fail(
    `[exports-are-referenced] ${dead.length} export(s) are referenced nowhere:`,
  )
  for (let i = 0, { length } = dead; i < length; i += 1) {
    logger.substep(`${dead[i]!.file}: ${dead[i]!.name}`)
  }
  logger.error(
    'Wanted: every export reachable from some caller, doc or manifest. ' +
      'Fix: delete it, or reference it from the code that was meant to use it. ' +
      'A name occurring once repo-wide is its own declaration and nothing else.',
  )
  return 1
}

const SCRIPT_META: ScriptMeta = {
  describe: 'checks that every exported symbol is referenced somewhere',
  help: `Usage: node scripts/fleet/check/exports-are-referenced.mts [flags]
  --json   print the findings as JSON`,
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  runMain(() => {
    process.exitCode = main()
  }, SCRIPT_META)
}
/* c8 ignore stop */
