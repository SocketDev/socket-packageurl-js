/*
 * @file The Lock-step review assistant — turns the re-port review + portedAt
 *   advancement into a repeatable step instead of a hand-edit a session has to
 *   remember. Read mode (default) surfaces every composite port whose
 *   `.gitmodules` pin advanced past `portedAt`, fetches the upstream action.yml
 *   at both tags, diffs the PORTED SURFACE (inputs + outputs), and reports the
 *   delta + the composite's current input set so the reviewer can decide
 *   whether the port needs a change. `--advance <composite>` writes the
 *   portedAt bump into the TEMPLATE port map (never the live mirror) and prints
 *   the cascade reminder + a suggested commit message carrying the verdict.
 *   Doctrine: docs/agents.md/fleet/upstream-references.md. The gate is
 *   `action-ports-are-lock-stepped.mts`; this script is the review surface that
 *   feeds it.
 *   Usage: node scripts/fleet/review-action-ports.mts
 *          node scripts/fleet/review-action-ports.mts --advance <composite>
 */

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { REPO_ROOT } from './paths.mts'
import {
  COMPOSITE_ACTION_PORTS,
  upstreamSubmoduleName,
} from './_shared/action-port-map.mts'
import { parseGitmodules } from './_shared/gitmodules.mts'
import { isMainModule } from './_shared/is-main-module.mts'
import { runMain } from './_shared/run-main.mts'

import type { CompositePort } from './_shared/action-port-map.mts'
import type { GitmodulesEntry } from './_shared/gitmodules.mts'
import type { ScriptMeta } from './_shared/run-main.mts'
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'

const logger = getDefaultLogger()

// The template port map is the canonical source; --advance writes here, never
// the live mirror. The cascade moves the live copy.
const TEMPLATE_PORT_MAP = path.join(
  REPO_ROOT,
  'template',
  'base',
  'scripts',
  'fleet',
  '_shared',
  'action-port-map.mts',
)

// A surface key: an `inputs:` or `outputs:` name from an action.yml. The
// composite ports a DELIBERATE SUBSET of the upstream surface, so a new
// upstream input is a review question (does the composite mirror it?), not an
// automatic change.
interface Surface {
  inputs: string[]
  outputs: string[]
}

// One port whose pin advanced past its review record.
interface BehindPort {
  composite: string
  upstream: string
  portedAt: string
  pinTag: string
  // The upstream surface delta (portedAt -> pinTag). Undefined when the fetch
  // failed (no network / gh unavailable) — the report then falls back to the
  // tag delta alone.
  delta: SurfaceDelta | undefined
  fetchError: string | undefined
}

interface SurfaceDelta {
  addedInputs: string[]
  removedInputs: string[]
  addedOutputs: string[]
  removedOutputs: string[]
}

// Split on LF after normalizing CRLF so a Windows-line-ending action.yml does
// not leave a trailing `\r` on every key name.
function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, '\n').split(/\r?\n/)
}

// Parse the `inputs:` and `outputs:` KEY NAMES out of an action.yml string.
// Values are irrelevant to the ported surface — only the keys a composite might
// need to mirror. Pure.
export function parseActionYmlSurface(yml: string): Surface {
  return {
    inputs: parseSectionKeys(yml, 'inputs'),
    outputs: parseSectionKeys(yml, 'outputs'),
  }
}

// Collect the top-level key names under a `<section>:` block. The block runs
// until the next top-level key (a line at column 0 ending `:`) or EOF. Pure.
function parseSectionKeys(yml: string, section: string): string[] {
  const lines = splitLines(yml)
  let inSection = false
  const keys: string[] = []
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    const topKey = /^([A-Za-z][\w-]*):$/.exec(line)
    if (topKey) {
      inSection = topKey[1] === section
      continue
    }
    if (!inSection) {
      continue
    }
    // A 2-space-indented `  <key>:` opens an input/output entry.
    const entryKey = /^  ([A-Za-z][\w-]*):/.exec(line)
    if (entryKey) {
      keys.push(entryKey[1]!)
    }
  }
  return keys
}

// Diff two surfaces into the added/removed keys a reviewer cares about. Pure.
export function diffSurface(oldSurface: Surface, next: Surface): SurfaceDelta {
  return {
    addedInputs: next.inputs.filter(k => !oldSurface.inputs.includes(k)),
    removedInputs: oldSurface.inputs.filter(k => !next.inputs.includes(k)),
    addedOutputs: next.outputs.filter(k => !oldSurface.outputs.includes(k)),
    removedOutputs: oldSurface.outputs.filter(k => !next.outputs.includes(k)),
  }
}

// Fetch an upstream action.yml at a tag via `gh api` (GitHub Contents API),
// base64-decode it. Returns the YAML text, or throws with a loud message on any
// failure (network, auth, missing file). The caller degrades to a no-network
// report rather than false-greening.
export async function fetchActionYml(
  slug: string,
  tag: string,
): Promise<string> {
  const url = `repos/${slug}/contents/action.yml?ref=${tag}`
  const result = await spawn('gh', ['api', url, '--jq', '.content'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.code !== 0) {
    throw new Error(
      `gh api ${url} failed (exit ${result.code}): ${result.stderr.trim() || result.stdout.trim()}`,
    )
  }
  const b64 = result.stdout.trim()
  return Buffer.from(b64, 'base64').toString('utf8')
}

// The ports whose pin advanced past portedAt. A tag-pinned port is behind when
// `entry.branch !== port.portedAt`; a branch-pinned port (portedSha set) is
// behind when `entry.ref !== port.portedSha`. Pure.
export function findBehindPorts(
  entries: readonly GitmodulesEntry[],
  portMap: Readonly<
    Record<string, readonly CompositePort[]>
  > = COMPOSITE_ACTION_PORTS,
): Array<{ composite: string; port: CompositePort; pinTag: string }> {
  const byName = new Map(entries.map(e => [e.name, e]))
  const behind: Array<{
    composite: string
    port: CompositePort
    pinTag: string
  }> = []
  const composites = Object.keys(portMap).toSorted()
  for (let i = 0, { length } = composites; i < length; i += 1) {
    const composite = composites[i]!
    for (const port of portMap[composite]!) {
      if (port.portedSha) {
        continue // Branch-pinned ports use a SHA anchor; out of scope for the tag-diff flow.
      }
      const sub = upstreamSubmoduleName(port.upstream)
      const entry = byName.get(sub)
      if (!entry?.branch || entry.branch === port.portedAt) {
        continue
      }
      behind.push({ composite, port, pinTag: entry.branch })
    }
  }
  return behind
}

// Build the read-mode report: for each behind port, fetch the surface at both
// tags + diff. Network failures degrade to a tag-delta-only line, never a
// false-green.
async function buildBehindReports(
  behind: ReadonlyArray<{
    composite: string
    port: CompositePort
    pinTag: string
  }>,
): Promise<BehindPort[]> {
  const reports: BehindPort[] = []
  for (let i = 0, { length } = behind; i < length; i += 1) {
    const { composite, port, pinTag } = behind[i]!
    let delta: SurfaceDelta | undefined
    let fetchError: string | undefined
    try {
      const oldYml = await fetchActionYml(port.upstream, port.portedAt)
      const newYml = await fetchActionYml(port.upstream, pinTag)
      delta = diffSurface(
        parseActionYmlSurface(oldYml),
        parseActionYmlSurface(newYml),
      )
    } catch (e) {
      fetchError = errorMessage(e)
    }
    reports.push({
      composite,
      upstream: port.upstream,
      portedAt: port.portedAt,
      pinTag,
      delta,
      fetchError,
    })
  }
  return reports
}

// Print the read-mode report. Exit 1 when any port is behind (so the weekly
// deterministic chain can treat it as an advisory-then-action step).
function printReport(reports: readonly BehindPort[]): number {
  if (reports.length === 0) {
    logger.success(
      'All composite ports are current — no pin ahead of its portedAt.',
    )
    return 0
  }
  const lines: string[] = [
    '[review-action-ports] Composite ports behind their upstream pin:',
    '',
  ]
  for (let i = 0, { length } = reports; i < length; i += 1) {
    const r = reports[i]!
    lines.push(
      `  ${r.composite}: ports ${r.upstream} at ${r.portedAt}, pin is ${r.pinTag}.`,
    )
    if (r.fetchError) {
      lines.push(
        '    surface diff: UNAVAILABLE — re-review the upstream diff by hand, then --advance.',
      )
      lines.push(`    (${r.fetchError})`)
    } else if (r.delta) {
      const added = r.delta.addedInputs
      const removed = r.delta.removedInputs
      if (added.length === 0 && removed.length === 0) {
        lines.push('    surface diff: no input/output keys changed.')
      } else {
        if (added.length > 0) {
          lines.push(`    added inputs: ${added.join(', ')}`)
        }
        if (removed.length > 0) {
          lines.push(`    removed inputs: ${removed.join(', ')}`)
        }
      }
      lines.push(
        '    Confirm the composite needs no change for the delta, then --advance.',
      )
    }
  }
  logger.fail(lines.join('\n'))
  return 1
}

// Advance `portedAt` for <composite> to its pinned tag in the TEMPLATE port map.
// Writes the template source only; the cascade moves the live mirror. Prints the
// cascade reminder + a suggested commit message carrying the verdict.
export function advancePortedAt(
  composite: string,
  entries: readonly GitmodulesEntry[],
  options?:
    | {
        portMap?: Readonly<Record<string, readonly CompositePort[]>> | undefined
        portMapPath?: string | undefined
      }
    | undefined,
): number {
  const { portMap = COMPOSITE_ACTION_PORTS, portMapPath = TEMPLATE_PORT_MAP } =
    { __proto__: null, ...options } as NonNullable<typeof options>
  const ports = portMap[composite]
  if (!ports) {
    logger.fail(
      `${composite}: no port-map entry — check the composite name in scripts/fleet/_shared/action-port-map.mts.`,
    )
    return 1
  }
  const byName = new Map(entries.map(e => [e.name, e]))
  let prevTag = ''
  let nextTag = ''
  let upstream = ''
  for (const port of ports) {
    if (port.portedSha) {
      continue
    }
    const sub = upstreamSubmoduleName(port.upstream)
    const entry = byName.get(sub)
    if (!entry?.branch || entry.branch === port.portedAt) {
      continue
    }
    prevTag = port.portedAt
    nextTag = entry.branch
    upstream = port.upstream
    break
  }
  if (!nextTag) {
    logger.log(
      `${composite}: already in lock-step (no tag-pinned port behind its pin).`,
    )
    return 0
  }
  const src = readFileSync(portMapPath, 'utf8')
  // Replace the portedAt for this composite's tag-pinned port. Match the
  // existing single-line map entry shape.
  const before = `'${composite}': [{ portedAt: '${prevTag}', upstream: '${upstream}' }]`
  const after = `'${composite}': [{ portedAt: '${nextTag}', upstream: '${upstream}' }]`
  if (!src.includes(before)) {
    logger.fail(
      `${composite}: could not find the expected map line \`${before}\` in ${path.relative(REPO_ROOT, portMapPath)} — the entry shape may have changed; edit it by hand.`,
    )
    return 1
  }
  writeFileSync(
    portMapPath,
    src.replace(before, () => after),
  )
  logger.success(
    `${composite}: advanced portedAt ${prevTag} -> ${nextTag} in ${path.relative(REPO_ROOT, portMapPath)}.`,
  )
  logger.group('Next: cascade + verify.')
  logger.log(
    'node scripts/repo/sync-scaffolding/cli.mts --target . --fix --no-commit',
  )
  logger.log('node scripts/fleet/check/action-ports-are-lock-stepped.mts')
  logger.groupEnd()
  logger.log(
    [
      'Suggested commit message:',
      `  fix(fleet): advance ${composite} portedAt to ${nextTag}`,
      '',
      '  Re-port review verdict: <record the surface delta here>',
    ].join('\n'),
  )
  return 0
}

async function main(): Promise<number> {
  const args = process.argv.slice(2)
  const advanceIdx = args.indexOf('--advance')
  if (advanceIdx !== -1) {
    const composite = args[advanceIdx + 1]
    if (!composite) {
      logger.fail('--advance needs a composite name: --advance <composite>')
      return 1
    }
    const entries = parseGitmodules(
      readFileSync(path.join(REPO_ROOT, '.gitmodules'), 'utf8'),
    )
    return advancePortedAt(composite, entries)
  }
  const entries = parseGitmodules(
    readFileSync(path.join(REPO_ROOT, '.gitmodules'), 'utf8'),
  )
  const behind = findBehindPorts(entries)
  if (behind.length === 0) {
    logger.success(
      'All composite ports are current — no pin ahead of its portedAt.',
    )
    return 0
  }
  const reports = await buildBehindReports(behind)
  return printReport(reports)
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'surface composite ports behind their upstream pin + advance portedAt after a re-port review',
  help: 'Usage: node scripts/fleet/review-action-ports.mts [--advance <composite>]',
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
/* c8 ignore stop */
