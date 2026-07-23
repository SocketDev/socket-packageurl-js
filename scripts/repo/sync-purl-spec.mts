/**
 * @file Repo-owned sync: vendors the package-url/purl-spec conformance suite
 *   (tests/spec/_.json + tests/types/_.json) into test/fixtures/purl-spec/
 *   {spec,types} from the ref pinned in .config/repo/purl-spec-pin.json. The
 *   vendored JSON is script-owned and byte-identical to upstream (test/
 *   fixtures/ sits in the fleet oxfmt ignore list for exactly this reason) —
 *   hand-edits are drift this sync detects and overwrites.
 *   test/data/contrib-tests.json is Socket-authored and never touched. The
 *   pinned checkout is cached OUT OF TREE at node_modules/.cache/purl-spec/
 *   (documented invisible store; a cached pin re-syncs offline). The corpus is
 *   ~40 small JSON files exercised in-process by test/purl-spec.test.mts, so
 *   the fleet 4-tier conformance-runner layout (sparse submodule + runner CLI)
 *   is deliberately not used. Usage: node scripts/repo/sync-purl-spec.mts
 *   [--check | --bump] [--quiet]
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
} from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { isQuiet } from '@socketsecurity/lib-stable/argv/flag-predicates'
import { readJson } from '@socketsecurity/lib-stable/fs/read-json'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { writeJson } from '@socketsecurity/lib-stable/fs/write-json'
import type { Logger } from '@socketsecurity/lib-stable/logger/types'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { NODE_MODULES_CACHE_DIR, REPO_ROOT } from '../fleet/paths.mts'

const logger: Logger = getDefaultLogger()

const PIN_JSON_PATH = path.join(
  REPO_ROOT,
  '.config',
  'repo',
  'purl-spec-pin.json',
)
const SPEC_CACHE_DIR = path.join(NODE_MODULES_CACHE_DIR, 'purl-spec')
const VENDORED_SUITE_DIR = path.join(REPO_ROOT, 'test', 'fixtures', 'purl-spec')

// Upstream suite directory → vendored directory, relative pairs.
const SUITE_DIRS: ReadonlyArray<{ from: string; to: string }> = [
  { from: path.join('tests', 'spec'), to: 'spec' },
  { from: path.join('tests', 'types'), to: 'types' },
]

export interface PurlSpecPin {
  readonly comment: string
  readonly ref: string
  readonly repository: string
}

export interface SuiteDrift {
  readonly kind: 'changed' | 'missing' | 'stale'
  readonly relPath: string
}

export async function readPin(): Promise<PurlSpecPin> {
  const pin = (await readJson(PIN_JSON_PATH)) as PurlSpecPin | undefined
  // A 40-hex ref keeps the checkout reproducible and lets the cache be
  // addressed by SHA; reject branch names early.
  const shaRe = /^[0-9a-f]{40}$/
  if (!pin?.repository || !pin.ref || !shaRe.test(pin.ref)) {
    throw new Error(
      `invalid purl-spec pin: expected { repository, ref: <40-hex sha> } in ${PIN_JSON_PATH}, ` +
        `saw ${JSON.stringify(pin)}. Fix: restore the pin file or re-run with --bump.`,
    )
  }
  return pin
}

async function git(
  args: string[],
  options?: { cwd?: string | undefined } | undefined,
) {
  const opts = { __proto__: null, ...options } as typeof options
  const result = await spawn('git', args, {
    cwd: opts?.cwd ?? REPO_ROOT,
    stdioString: true,
  })
  if (result.code !== 0) {
    throw new Error(
      `git ${args.join(' ')} failed in ${opts?.cwd ?? REPO_ROOT}: ` +
        `exit ${result.code}, stderr: ${result.stderr}. ` +
        'Fix: check network access and that the pinned ref exists upstream.',
    )
  }
  return result
}

/**
 * Materialize the pinned purl-spec checkout under node_modules/.cache and
 * return its path. Reuses an existing checkout when its HEAD matches the pin,
 * so repeat syncs (and --check) run offline.
 */
export async function materializePinnedSpec(pin: PurlSpecPin): Promise<string> {
  const checkoutDir = path.join(SPEC_CACHE_DIR, pin.ref)
  if (existsSync(path.join(checkoutDir, '.git'))) {
    const head = await spawn('git', ['rev-parse', 'HEAD'], {
      cwd: checkoutDir,
      stdioString: true,
    })
    if (head.code === 0 && head.stdout === pin.ref) {
      return checkoutDir
    }
    // Wrong or unreadable HEAD — rebuild the cache entry from scratch.
    await safeDelete(checkoutDir)
  }
  mkdirSync(checkoutDir, { recursive: true })
  await git(['init', '--quiet'], { cwd: checkoutDir })
  // Shallow single-SHA fetch: the depth=1 + explicit-SHA form is the
  // submodule-free equivalent of a `--depth=1 --single-branch` clone.
  await git(['fetch', '--quiet', '--depth=1', pin.repository, pin.ref], {
    cwd: checkoutDir,
  })
  await git(['checkout', '--quiet', '--detach', 'FETCH_HEAD'], {
    cwd: checkoutDir,
  })
  return checkoutDir
}

function listSuiteJson(dir: string): string[] {
  if (!existsSync(dir)) {
    return []
  }
  return (
    readdirSync(dir)
      .filter(name => name.endsWith('.json'))
      // oxlint-disable-next-line unicorn/no-array-sort -- engines.node floor is <20 so Array#toSorted is unavailable; filter() already returned a fresh array.
      .sort()
  )
}

/**
 * Diff the vendored suite against the pinned checkout. Returns one entry per
 * out-of-sync file: `missing` (upstream file not vendored), `changed` (bytes
 * differ), `stale` (vendored file gone upstream).
 */
export function diffSuite(checkoutDir: string): SuiteDrift[] {
  const drift: SuiteDrift[] = []
  for (const { from, to } of SUITE_DIRS) {
    const upstreamDir = path.join(checkoutDir, from)
    const vendoredDir = path.join(VENDORED_SUITE_DIR, to)
    const upstreamFiles = listSuiteJson(upstreamDir)
    const vendoredFiles = listSuiteJson(vendoredDir)
    const upstreamSet = new Set(upstreamFiles)
    for (const name of upstreamFiles) {
      const relPath = path.join(to, name)
      const vendoredPath = path.join(vendoredDir, name)
      if (!existsSync(vendoredPath)) {
        drift.push({ kind: 'missing', relPath })
        continue
      }
      const upstreamBytes = readFileSync(path.join(upstreamDir, name), 'utf8')
      const vendoredBytes = readFileSync(vendoredPath, 'utf8')
      if (upstreamBytes !== vendoredBytes) {
        drift.push({ kind: 'changed', relPath })
      }
    }
    for (const name of vendoredFiles) {
      if (!upstreamSet.has(name)) {
        drift.push({ kind: 'stale', relPath: path.join(to, name) })
      }
    }
  }
  return drift
}

export async function applySuite(
  checkoutDir: string,
  drift: SuiteDrift[],
): Promise<void> {
  for (let i = 0, { length } = drift; i < length; i += 1) {
    const entry = drift[i]
    const vendoredPath = path.join(VENDORED_SUITE_DIR, entry.relPath)
    if (entry.kind === 'stale') {
      await safeDelete(vendoredPath)
      continue
    }
    const [suiteDir] = SUITE_DIRS.filter(d =>
      entry.relPath.startsWith(`${d.to}${path.sep}`),
    )
    if (!suiteDir) {
      throw new Error(
        `unmapped drift path ${entry.relPath}: expected a prefix of ` +
          `${SUITE_DIRS.map(d => d.to).join(' or ')}. Fix: update SUITE_DIRS.`,
      )
    }
    const upstreamPath = path.join(
      checkoutDir,
      suiteDir.from,
      path.basename(entry.relPath),
    )
    mkdirSync(path.dirname(vendoredPath), { recursive: true })
    copyFileSync(upstreamPath, vendoredPath)
  }
}

export async function bumpPin(pin: PurlSpecPin): Promise<PurlSpecPin> {
  const result = await git(['ls-remote', pin.repository, 'HEAD'])
  // ls-remote prints `<sha>\tHEAD`; take the leading 40-hex token.
  const sha = /^[0-9a-f]{40}/.exec(result.stdout)?.[0]
  if (!sha) {
    throw new Error(
      `could not resolve HEAD of ${pin.repository}: ls-remote printed ` +
        `${JSON.stringify(result.stdout)}, wanted "<40-hex sha>\\tHEAD". ` +
        'Fix: check network access and the repository URL in the pin file.',
    )
  }
  if (sha === pin.ref) {
    return pin
  }
  const next: PurlSpecPin = { ...pin, ref: sha }
  await writeJson(PIN_JSON_PATH, next, { spaces: 2 })
  return next
}

async function main(): Promise<void> {
  const quiet = isQuiet(process.argv)
  const check = process.argv.includes('--check')
  const bump = process.argv.includes('--bump')
  if (check && bump) {
    throw new Error(
      'flags --check and --bump conflict: --check must not write. ' +
        'Fix: pass one or the other.',
    )
  }
  let pin = await readPin()
  if (bump) {
    const next = await bumpPin(pin)
    if (!quiet && next.ref !== pin.ref) {
      logger.log(
        `pin bumped ${pin.ref.slice(0, 12)} → ${next.ref.slice(0, 12)}`,
      )
    }
    pin = next
  }
  const checkoutDir = await materializePinnedSpec(pin)
  const drift = diffSuite(checkoutDir)
  if (!drift.length) {
    if (!quiet) {
      logger.log(`vendored suite matches purl-spec@${pin.ref.slice(0, 12)}.`)
    }
    return
  }
  if (check) {
    logger.error(
      `vendored purl-spec suite drifts from the pin in ${PIN_JSON_PATH} ` +
        `(purl-spec@${pin.ref.slice(0, 12)}) at ${drift.length} path(s) under test/fixtures/purl-spec/:`,
    )
    for (const entry of drift) {
      logger.error(`  ${entry.kind}: ${entry.relPath}`)
    }
    logger.error('Fix: run `node scripts/repo/sync-purl-spec.mts`.')
    process.exitCode = 1
    return
  }
  await applySuite(checkoutDir, drift)
  if (!quiet) {
    for (const entry of drift) {
      logger.log(
        `${entry.kind === 'stale' ? 'removed' : 'synced'}: ${entry.relPath}`,
      )
    }
    logger.log(
      `vendored ${drift.length} path(s) from purl-spec@${pin.ref.slice(0, 12)}.`,
    )
  }
}

// Entry-point guard so test files can import the exports without running main.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void (async () => {
    try {
      await main()
    } catch (e) {
      logger.error(e)
      process.exitCode = 1
    }
  })()
}
