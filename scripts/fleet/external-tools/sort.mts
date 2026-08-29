#!/usr/bin/env node
/**
 * @file `external-tools sort` — reorder the `tools` keys in every shipped
 *   manifest alphanumerically. Dry-run by default: prints the reordering it
 *   would apply; `--apply` writes through EditableJson so only key order
 *   changes — values + formatting survive. Usage:
 *   node scripts/fleet/external-tools/sort.mts [--target <file>] [--apply]
 */

import process from 'node:process'

import type { EditableJsonInstance } from '@socketsecurity/lib-stable/json/types'

import {
  loadManifest,
  relPath,
  requireValue,
  resolveTargets,
} from './_shared.mts'
import type { ExternalToolsJson } from './update.mts'

import { reportSkippedMirrors } from '../_shared/cascaded-mirrors.mts'
import { runMain } from '../_shared/run-main.mts'
import type { ScriptMeta } from '../_shared/run-main.mts'

export interface SortConfig {
  target: string | undefined
  apply: boolean
}

export function parseArgs(
  options?: { argv?: string[] | undefined } | undefined,
): SortConfig {
  const { argv = process.argv.slice(2) } = {
    __proto__: null,
    ...options,
  } as NonNullable<typeof options>
  const opts: SortConfig = {
    target: undefined,
    apply: false,
  }
  for (let i = 0, { length } = argv; i < length; i += 1) {
    const a = argv[i]!
    if (a === '--apply') {
      opts.apply = true
    } else if (a === '--target') {
      opts.target = requireValue(argv, i, '--target')
      i += 1
    } else if (a.startsWith('-')) {
      throw new Error(`Unknown argument: ${a}`)
    } else {
      throw new Error(`Unexpected positional argument: ${a}`)
    }
  }
  return opts
}

/**
 * A sorted copy of `tools`'s keys, alphanumerically. Returns the rebuilt
 * object (key order changed, values identical). Pure — no I/O.
 */
export function sortTools(
  tools: Record<string, unknown>,
): Record<string, unknown> {
  const keys = Object.keys(tools).toSorted((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  )
  const out: Record<string, unknown> = {}
  for (let i = 0, { length } = keys; i < length; i += 1) {
    const key = keys[i]!
    out[key] = tools[key]
  }
  return out
}

/**
 * True when `tools`'s keys are already alphanumerically sorted.
 */
export function isSorted(tools: Record<string, unknown>): boolean {
  const keys = Object.keys(tools)
  const sorted = [...keys].toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  for (let i = 0, { length } = keys; i < length; i += 1) {
    if (keys[i] !== sorted[i]) {
      return false
    }
  }
  return true
}

export async function main(
  options?: { argv?: string[] | undefined } | undefined,
): Promise<number> {
  const { argv = process.argv.slice(2) } = {
    __proto__: null,
    ...options,
  } as NonNullable<typeof options>
  const opts = parseArgs({ argv })
  const targets = resolveTargets({ sources: true, target: opts.target })
  let anyChange = false
  // Mirrors this pass could not write, reported together at the end.
  const skippedMirrors: string[] = []
  for (let i = 0, { length } = targets; i < length; i += 1) {
    const target = targets[i]!
    let editable: EditableJsonInstance<ExternalToolsJson>
    try {
      editable = await loadManifest(target)
    } catch {
      continue
    }
    const tools = editable.content.tools ?? {}
    if (isSorted(tools)) {
      continue
    }
    anyChange = true
    const sorted = sortTools(tools)
    const before = Object.keys(tools).join(', ')
    const after = Object.keys(sorted).join(', ')
    process.stdout.write(
      `--- ${relPath(target)} (${opts.apply ? 'sort' : 'would sort'})\n`,
    )
    process.stdout.write(`  before: ${before}\n`)
    process.stdout.write(`  after:  ${after}\n`)
    if (opts.apply) {
      editable.update({ tools: sorted as ExternalToolsJson['tools'] })
      try {
        await editable.save({ sort: false })
        process.stdout.write(`Wrote ${relPath(target)}\n`)
      } catch (e) {
        // A named --target is the caller asking for THAT file, so a refusal is
        // their answer and it throws. In a sweep the mirror is incidental: the
        // manifest is sorted at its template source already, so an unsorted
        // mirror means the member is behind a cascade rather than needing a
        // hand-sort, and dying partway left the later manifests untouched.
        if (opts.target) {
          throw e
        }
        skippedMirrors.push(relPath(target))
      }
    }
  }
  reportSkippedMirrors('external-tools-are-sorted', skippedMirrors)
  if (!anyChange) {
    process.stdout.write('All manifests already sorted.\n')
  }
  if (!opts.apply && anyChange) {
    process.stdout.write('\nDry run. Pass --apply to write.\n')
  }
  return 0
}

const SCRIPT_META: ScriptMeta = {
  describe: 'sort external-tools.json tool keys alphanumerically',
  help: `Usage: node scripts/fleet/external-tools/sort.mts [flags]
  --target <file>  limit to one manifest file
  --apply          write the sort (default is a dry run)`,
}

if (import.meta.main) {
  runMain(main, SCRIPT_META)
}
