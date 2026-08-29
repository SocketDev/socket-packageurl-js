#!/usr/bin/env node
/*
 * @file `check --all` gate: every DERIVED copy of the host allowlist matches
 *   the one list it derives from.
 *
 *   `.config/fleet/fetch-allowlist.json`'s `hosts[]` is the single source of
 *   truth. Two copies exist for reasons that are not going away soon, and both
 *   were hand-maintained, which is why both had already drifted:
 *
 *   1. `allowDomains` in that same JSON — the pre-v2 key a member still on an
 *      older bundled hook reads. Documented as "kept byte-identical" to the
 *      runtime-scoped hosts; it was missing two of them, so the containment gate
 *      that read it was checking 13 hosts while the guard granted 15.
 *   2. `SNAPSHOT_HOSTS` in `_shared/fetch-allowlist.mts` — the fail-closed
 *      fallback the guard uses when the JSON cannot be read. It has to be
 *      inlined, since its whole job is to work when that read has failed.
 *
 *   A copy nobody regenerates is a copy that drifts, and both of these fail
 *   quietly: the stale one simply grants or checks less than the real list. So
 *   this gate owns them. `--fix` rewrites both from `hosts[]`; the JSON is the
 *   only thing anyone edits by hand.
 *
 *   Writes the template copy when one exists (the wheelhouse cascades its own
 *   payload, so the live mirror is rehydrated and is mode 444), else the live
 *   file — the same source-of-truth rule the rest of the fleet's fixers follow.
 *
 *   Usage: node scripts/fleet/check/fetch-allowlist-derived-copies-are-current.mts [--fix] [--json]
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  ALLOWLIST_REL,
  ALLOWLIST_SCOPES,
  hostsForScope,
} from '../../../.claude/hooks/fleet/_shared/fetch-allowlist.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import { REPO_ROOT } from '../paths.mts'

import type { AllowlistScope } from '../../../.claude/hooks/fleet/_shared/fetch-allowlist.mts'
import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

const READER_REL = path.join(
  '.claude',
  'hooks',
  'fleet',
  '_shared',
  'fetch-allowlist.mts',
)

/**
 * The generated region in the reader. Both markers are matched so a hand edit
 * outside them survives a --fix untouched.
 */
const SNAPSHOT_REGION_RE =
  /(\/\/ <generated:snapshot-hosts>\n)[\s\S]*?(\n\/\/ <\/generated:snapshot-hosts>)/u

export interface DerivedFinding {
  readonly copy: string
  readonly missing: readonly string[]
  readonly unexpected: readonly string[]
}

/**
 * `template/base/<rel>` when it exists, else `<rel>`. A cascaded live mirror is
 * mode 444 and gets rehydrated, so a fixer that writes it both fails and loses.
 */
export function writableSourceOf(repoRoot: string, rel: string): string {
  const templated = path.join('template', 'base', rel)
  return existsSync(path.join(repoRoot, templated)) ? templated : rel
}

/**
 * The set difference both ways, or undefined when `saw` already equals `want`.
 * Pure. Order-insensitive: a copy that carries the right hosts in another order
 * is not drift, and reporting it as such would train people to ignore the gate.
 */
export function diffHosts(
  saw: readonly string[],
  want: readonly string[],
): { missing: string[]; unexpected: string[] } | undefined {
  const sawSet = new Set(saw)
  const wantSet = new Set(want)
  const missing = want.filter(h => !sawSet.has(h))
  const unexpected = saw.filter(h => !wantSet.has(h))
  return missing.length === 0 && unexpected.length === 0
    ? undefined
    : { missing, unexpected }
}

/**
 * The `SNAPSHOT_HOSTS` literal for `scoped`, rendered as the reader's own
 * formatting so a --fix leaves a diff of hosts and nothing else.
 */
export function renderSnapshot(
  scoped: Readonly<Record<AllowlistScope, readonly string[]>>,
): string {
  const lines = [
    'export const SNAPSHOT_HOSTS: Readonly<',
    '  Record<AllowlistScope, readonly string[]>',
    '> = {',
  ]
  for (let i = 0, { length } = ALLOWLIST_SCOPES; i < length; i += 1) {
    const scope = ALLOWLIST_SCOPES[i]!
    const hosts = scoped[scope]
    if (hosts.length === 0) {
      lines.push(`  ${scope}: [],`)
      continue
    }
    lines.push(`  ${scope}: [`)
    for (let j = 0, { length: hl } = hosts; j < hl; j += 1) {
      lines.push(`    '${hosts[j]!}',`)
    }
    lines.push('  ],')
  }
  lines.push('}')
  return lines.join('\n')
}

/**
 * The hosts each scope grants, read from `hosts[]`. Throws when the JSON has no
 * usable `hosts` array — the caller reports that as the failure it is.
 */
export function scopedHostsOf(
  parsed: unknown,
): Record<AllowlistScope, readonly string[]> {
  const out = {} as Record<AllowlistScope, readonly string[]>
  for (let i = 0, { length } = ALLOWLIST_SCOPES; i < length; i += 1) {
    const scope = ALLOWLIST_SCOPES[i]!
    const hosts = hostsForScope(parsed, scope)
    if (!hosts) {
      throw new Error(`${ALLOWLIST_REL} has no "hosts" array`)
    }
    out[scope] = hosts
  }
  return out
}

/**
 * Every derived copy that disagrees with `hosts[]`. Pure given the two texts.
 */
export function findDrift(
  allowlistText: string,
  readerText: string,
): DerivedFinding[] {
  const parsed = JSON.parse(allowlistText) as {
    allowDomains?: unknown | undefined
  }
  const scoped = scopedHostsOf(parsed)
  const findings: DerivedFinding[] = []

  const sawAllowDomains = Array.isArray(parsed.allowDomains)
    ? parsed.allowDomains.filter(h => typeof h === 'string')
    : []
  const allowDrift = diffHosts(sawAllowDomains, scoped.runtime)
  if (allowDrift) {
    findings.push({ copy: `${ALLOWLIST_REL} → allowDomains`, ...allowDrift })
  }

  const region = SNAPSHOT_REGION_RE.exec(readerText)
  const want = renderSnapshot(scoped)
  if (!region) {
    findings.push({
      copy: `${READER_REL} → SNAPSHOT_HOSTS`,
      missing: ['the <generated:snapshot-hosts> markers'],
      unexpected: [],
    })
  } else if (region[0] !== `${region[1]!}${want}${region[2]!}`) {
    // Host-level diff rather than a text diff: the point is which hosts moved.
    const saw = [...readerText.matchAll(/^ {4}'([^']+)',$/gmu)].map(m => m[1]!)
    const wantHosts = ALLOWLIST_SCOPES.flatMap(s => [...scoped[s]])
    findings.push({
      copy: `${READER_REL} → SNAPSHOT_HOSTS`,
      ...(diffHosts(saw, wantHosts) ?? { missing: [], unexpected: [] }),
    })
  }
  return findings
}

/**
 * Rewrite both derived copies from `hosts[]`. Returns the files it changed.
 */
export function applyFix(repoRoot: string): string[] {
  const allowlistRel = writableSourceOf(repoRoot, ALLOWLIST_REL)
  const readerRel = writableSourceOf(repoRoot, READER_REL)
  const allowlistPath = path.join(repoRoot, allowlistRel)
  const readerPath = path.join(repoRoot, readerRel)
  const allowlistText = readFileSync(allowlistPath, 'utf8')
  const scoped = scopedHostsOf(JSON.parse(allowlistText))
  const changed: string[] = []

  // Rewrite the array body in place, preserving the file's own indentation and
  // its `//` header: a JSON.parse → stringify round trip would drop both.
  const rendered = scoped.runtime.map(h => `    "${h}"`).join(',\n')
  // Group 1: the `"allowDomains": [` opener. Then lazily consume everything
  // up to group 2: a newline, 2-space indent, and the closing `]`.
  const nextAllowlist = allowlistText.replace(
    /("allowDomains"\s*:\s*\[)[\s\S]*?(\n {2}\])/u,
    (_m, open: string, close: string) => `${open}\n${rendered}${close}`,
  )
  if (nextAllowlist !== allowlistText) {
    writeFileSync(allowlistPath, nextAllowlist)
    changed.push(allowlistRel)
  }

  const readerText = readFileSync(readerPath, 'utf8')
  const nextReader = readerText.replace(
    SNAPSHOT_REGION_RE,
    (_m, open: string, close: string) =>
      `${open}${renderSnapshot(scoped)}${close}`,
  )
  if (nextReader !== readerText) {
    writeFileSync(readerPath, nextReader)
    changed.push(readerRel)
  }
  return changed
}

function main(): number {
  const allowlistPath = path.join(REPO_ROOT, ALLOWLIST_REL)
  if (!existsSync(allowlistPath)) {
    logger.log(
      `[fetch-allowlist-derived-copies] no ${ALLOWLIST_REL} here (not applicable).`,
    )
    return 0
  }
  if (process.argv.includes('--fix')) {
    const changed = applyFix(REPO_ROOT)
    if (changed.length === 0) {
      logger.success(
        '[fetch-allowlist-derived-copies] already current; nothing rewritten.',
      )
      return 0
    }
    for (let i = 0, { length } = changed; i < length; i += 1) {
      logger.log(`regenerated ${changed[i]!}`)
    }
    return 0
  }
  let findings: DerivedFinding[]
  try {
    findings = findDrift(
      readFileSync(allowlistPath, 'utf8'),
      readFileSync(path.join(REPO_ROOT, READER_REL), 'utf8'),
    )
  } catch (e) {
    logger.fail(`[fetch-allowlist-derived-copies] ${String(e)}`)
    return 1
  }
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify({ findings }, undefined, 2)}\n`)
    return findings.length === 0 ? 0 : 1
  }
  if (findings.length === 0) {
    logger.success(
      '[fetch-allowlist-derived-copies] every derived copy matches hosts[].',
    )
    return 0
  }
  for (let i = 0, { length } = findings; i < length; i += 1) {
    const finding = findings[i]!
    logger.fail(`[fetch-allowlist-derived-copies] ${finding.copy} has drifted:`)
    for (const host of finding.missing) {
      logger.substep(`missing: ${host}`)
    }
    for (const host of finding.unexpected) {
      logger.substep(`not in hosts[]: ${host}`)
    }
  }
  logger.error(
    'Wanted: every derived copy equal to the egress/fetch scopes of hosts[]. ' +
      'Fix: edit hosts[] only, then re-run with --fix.',
  )
  return 1
}

const SCRIPT_META: ScriptMeta = {
  describe: 'checks the allowlist derived copies match hosts[]',
  help: `Usage: node scripts/fleet/check/fetch-allowlist-derived-copies-are-current.mts [flags]
  --fix    regenerate every derived copy from hosts[]
  --json   print the findings as JSON`,
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  runMain(() => {
    process.exitCode = main()
  }, SCRIPT_META)
}
/* c8 ignore stop */
