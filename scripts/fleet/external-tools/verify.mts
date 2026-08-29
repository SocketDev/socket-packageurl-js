#!/usr/bin/env node
/**
 * @file `external-tools verify` — re-download every gh-asset platform's binary
 *   and recompute its sha512-SRI, comparing against the recorded integrity.
 *   Catches drift: a release that was re-published with a different binary at
 *   the same tag, or a hand-edited integrity that doesn't match the asset.
 *   Read-only — no `--apply`; a mismatch is reported and the run exits
 *   non-zero. Usage:
 *   node scripts/fleet/external-tools/verify.mts [--target <file>] [--quiet]
 */

import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  loadManifest,
  relPath,
  requireValue,
  resolveTargets,
} from './_shared.mts'
import { curlSha512, hexToSri } from './update.mts'
import type { GithubReleaseTool } from './update.mts'

import { runMain } from '../_shared/run-main.mts'
import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

export interface VerifyConfig {
  target: string | undefined
  quiet: boolean
}

export function parseArgs(
  options?: { argv?: string[] | undefined } | undefined,
): VerifyConfig {
  const { argv = process.argv.slice(2) } = {
    __proto__: null,
    ...options,
  } as NonNullable<typeof options>
  const opts: VerifyConfig = {
    target: undefined,
    quiet: false,
  }
  for (let i = 0, { length } = argv; i < length; i += 1) {
    const a = argv[i]!
    if (a === '--quiet') {
      opts.quiet = true
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
 * Extract the SRI string from an `integrity` field that may be a bare string
 * or a provenance object `{ value, src?, date? }`. Returns the SRI string or
 * `undefined` when the field is absent.
 */
export function integrityValue(
  integrity: string | { value: string } | undefined,
): string | undefined {
  if (typeof integrity === 'string') {
    return integrity
  }
  return integrity?.value
}

interface Mismatch {
  tool: string
  platform: string
  expected: string
  actual: string
}

/**
 * Verify every gh-asset tool's platform integrities by re-downloading +
 * re-hashing. Returns one `Mismatch` per drift, empty when all match. Pure
 * over the manifest data + the injected `curlSha512`/`hexToSri` deps so a unit
 * test can drive it without the network.
 */
export function verifyGithubIntegrities(
  tools: Record<string, unknown>,
  deps: {
    curlSha512: (url: string) => string | undefined
    hexToSri: (hex: string) => string
  },
): Mismatch[] {
  const mismatches: Mismatch[] = []
  const names = Object.keys(tools)
  for (let i = 0, { length } = names; i < length; i += 1) {
    const name = names[i]!
    const tool = tools[name] as unknown as GithubReleaseTool
    if (tool.origin !== 'gh-asset' || !tool.platforms) {
      continue
    }
    const slug = tool.repository.replace(/^github:/, '')
    const tag = tool.version
    const platformKeys = Object.keys(tool.platforms)
    for (let j = 0, { length: pLen } = platformKeys; j < pLen; j += 1) {
      const pkey = platformKeys[j]!
      const entry = tool.platforms[pkey]!
      const expected = integrityValue(
        entry.integrity as string | { value: string } | undefined,
      )
      if (!expected) {
        mismatches.push({
          actual: '(no integrity recorded)',
          expected: '(missing)',
          platform: pkey,
          tool: name,
        })
        continue
      }
      const assetUrl = `https://github.com/${slug}/releases/download/${tag}/${entry.asset}`
      const hex = deps.curlSha512(assetUrl)
      if (!hex) {
        mismatches.push({
          actual: '(fetch failed)',
          expected,
          platform: pkey,
          tool: name,
        })
        continue
      }
      const actual = deps.hexToSri(hex)
      if (actual !== expected) {
        mismatches.push({
          actual,
          expected,
          platform: pkey,
          tool: name,
        })
      }
    }
  }
  return mismatches
}

export async function main(
  options?: { argv?: string[] | undefined } | undefined,
): Promise<number> {
  const { argv = process.argv.slice(2) } = {
    __proto__: null,
    ...options,
  } as NonNullable<typeof options>
  const opts = parseArgs({ argv })
  const targets = resolveTargets({ target: opts.target })
  let anyMismatch = false
  for (let i = 0, { length } = targets; i < length; i += 1) {
    const target = targets[i]!
    let editable
    try {
      editable = await loadManifest(target)
    } catch {
      continue
    }
    const tools = (editable.content.tools ?? {}) as Record<string, unknown>
    const mismatches = verifyGithubIntegrities(tools, {
      curlSha512,
      hexToSri,
    })
    if (mismatches.length > 0) {
      anyMismatch = true
      logger.fail(
        `[external-tools verify] ${relPath(target)}: ${mismatches.length} mismatch(es)`,
      )
      for (let j = 0, { length: mLen } = mismatches; j < mLen; j += 1) {
        const m = mismatches[j]!
        logger.error(
          `  ${m.tool} [${m.platform}]: expected ${m.expected.slice(0, 30)}…, got ${m.actual.slice(0, 30)}…`,
        )
      }
    } else if (!opts.quiet) {
      logger.success(
        `[external-tools verify] ${relPath(target)}: all integrities match.`,
      )
    }
  }
  return anyMismatch ? 1 : 0
}

const SCRIPT_META: ScriptMeta = {
  describe:
    're-download + re-hash every gh-asset platform to verify recorded integrities',
  help: `Usage: node scripts/fleet/external-tools/verify.mts [flags]
  --target <file>  limit to one manifest file
  --quiet          suppress per-manifest pass messages`,
}

if (import.meta.main) {
  runMain(main, SCRIPT_META)
}
