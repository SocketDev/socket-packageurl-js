/**
 * @file Synchronize byte-exact PURL fixtures from the sparse, shallow
 *   .gitmodules pin.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { MILLISECONDS_PER_DAY } from '@socketsecurity/lib-stable/constants/time'
import { isQuiet } from '@socketsecurity/lib-stable/exe/argv/flag-predicates'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import type { Logger } from '@socketsecurity/lib-stable/logger/logger'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { isPlainObject } from '@socketsecurity/lib-stable/objects/predicates'
import { compare } from '@socketsecurity/lib-stable/versions/compare'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { compareStr } from '@socketsecurity/lib-stable/sorts/strings'

import { readPurlSpecSuite } from './purl-spec/read.mts'
import {
  GITMODULES_PATH,
  PURL_SPEC_FIXTURE_DIR,
  PURL_SPEC_UPSTREAM_DIR,
  PURL_SPEC_UPSTREAM_RELATIVE_PATH,
  REPO_CACHE_DIR,
  REPO_ROOT,
} from './paths.mts'
import { parseGitmodules } from '../fleet/git/modules.mts'
import { applySparsePatterns } from '../fleet/git-partial-submodule/internal.mts'
import { SOAK_DAYS } from '../fleet/constants/soak.mts'
import { isMainModule } from '../fleet/process/is-main-module.mts'
import { runMain } from '../fleet/process/run-main.mts'

const logger: Logger = getDefaultLogger()

// Upstream suite directory → vendored directory, relative pairs.
const SUITE_DIRS: ReadonlyArray<{ from: string; to: string }> = [
  { from: path.join('tests', 'spec'), to: 'spec' },
  { from: path.join('tests', 'types'), to: 'types' },
]

export interface PurlSpecPin {
  readonly releaseTag?: string | undefined
  readonly sparse: string
  readonly ref: string
  readonly repository: string
}

export interface SuiteDrift {
  readonly kind: 'changed' | 'missing' | 'stale'
  readonly relPath: string
}

export function parsePurlSpecPin(text: string): PurlSpecPin {
  const entries = parseGitmodules(text).filter(
    item => item.path === PURL_SPEC_UPSTREAM_RELATIVE_PATH,
  )
  const entry = entries.length === 1 ? entries[0] : undefined
  if (
    !entry?.url ||
    !entry.ref ||
    !/^[0-9a-f]{40}$/.test(entry.ref) ||
    !entry.shallow ||
    !entry.sparse ||
    !entry.headerSha
  ) {
    throw new Error(
      `Invalid purl-spec pin. Where: ${GITMODULES_PATH}. Saw: missing immutable, shallow, sparse reference; wanted: a complete upstream pin. Fix: run gitmodules:hash after restoring the entry.`,
    )
  }
  return { ref: entry.ref, repository: entry.url, sparse: entry.sparse }
}

export async function readPin(): Promise<PurlSpecPin> {
  return parsePurlSpecPin(readFileSync(GITMODULES_PATH, 'utf8'))
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

export async function materializePinnedSpec(pin: PurlSpecPin): Promise<string> {
  const checkoutDir = PURL_SPEC_UPSTREAM_DIR
  if (existsSync(path.join(checkoutDir, '.git'))) {
    const head = await spawn('git', ['rev-parse', 'HEAD'], {
      cwd: checkoutDir,
      stdioString: true,
    })
    const status = await git(['status', '--porcelain'], { cwd: checkoutDir })
    if (status.stdout.trim()) {
      throw new Error(
        `Cannot synchronize purl-spec. Where: ${checkoutDir}. Saw: local modifications; wanted: a clean upstream reference. Fix: preserve the local work before syncing.`,
      )
    }
    if (head.code === 0 && head.stdout.trim() === pin.ref) {
      await applySparsePatterns(
        { dryRun: false, verbose: false },
        checkoutDir,
        pin.sparse,
      )
      await git(['config', 'remote.origin.url', pin.repository], {
        cwd: checkoutDir,
      })
      return checkoutDir
    }
  } else {
    mkdirSync(checkoutDir, { recursive: true })
    await git(['init', '--quiet'], { cwd: checkoutDir })
  }
  await git(['config', 'remote.origin.url', pin.repository], {
    cwd: checkoutDir,
  })
  await git(
    ['fetch', '--quiet', '--depth=1', '--no-tags', pin.repository, pin.ref],
    { cwd: checkoutDir },
  )
  await applySparsePatterns(
    { dryRun: false, verbose: false },
    checkoutDir,
    pin.sparse,
  )
  await git(['checkout', '--quiet', '--detach', pin.ref], { cwd: checkoutDir })
  return checkoutDir
}

function listSuiteJson(dir: string, required = false): string[] {
  if (!existsSync(dir)) {
    if (required) {
      throw new Error(
        `Missing purl-spec suite. Where: ${dir}. Saw: absent directory; wanted: upstream JSON fixtures. Fix: verify the upstream layout before syncing.`,
      )
    }
    return []
  }
  return (
    readdirSync(dir)
      .filter(name => name.endsWith('.json'))
      // engines.node floor is <20 so Array#toSorted is unavailable; filter()
      // already returned a fresh array.
      .toSorted(compareStr)
  )
}

/**
 * Diff the vendored suite against the pinned checkout. Returns one entry per
 * out-of-sync file. A `missing` entry marks an upstream file that has not been
 * vendored, a `changed` entry marks a vendored file whose bytes differ, and a
 * `stale` entry marks a vendored file that no longer exists upstream.
 */
export function diffSuite(
  checkoutDir: string,
  options: { fixtureDir?: string | undefined } = {},
): SuiteDrift[] {
  const { fixtureDir = PURL_SPEC_FIXTURE_DIR } = options
  const drift: SuiteDrift[] = []
  for (const { from, to } of SUITE_DIRS) {
    const upstreamDir = path.join(checkoutDir, from)
    const vendoredDir = path.join(fixtureDir, to)
    const upstreamFiles = listSuiteJson(upstreamDir, true)
    if (!upstreamFiles.length) {
      throw new Error(
        `Empty purl-spec suite. Where: ${upstreamDir}. Saw: no JSON fixtures; wanted: a populated suite. Fix: verify the upstream layout before syncing.`,
      )
    }
    const vendoredFiles = listSuiteJson(vendoredDir)
    const upstreamSet = new Set(upstreamFiles)
    for (const name of upstreamFiles) {
      const relPath = path.join(to, name)
      const vendoredPath = path.join(vendoredDir, name)
      const upstreamPath = path.join(upstreamDir, name)
      const upstreamBytes = readFileSync(upstreamPath, 'utf8')
      readPurlSpecSuite(JSON.parse(upstreamBytes), upstreamPath)
      if (!existsSync(vendoredPath)) {
        drift.push({ kind: 'missing', relPath })
        continue
      }
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
  options: {
    fixtureDir?: string | undefined
    finalize?: (() => void) | undefined
  } = {},
): Promise<void> {
  const { fixtureDir = PURL_SPEC_FIXTURE_DIR, finalize } = options
  const changes = drift.map(entry => {
    const relPath = normalizePath(entry.relPath)
    if (!/^(?:spec|types)\/[^/]+\.json$/.test(relPath)) {
      throw new Error(
        `Invalid purl-spec drift path. Where: ${entry.relPath}. Saw: an unmapped path; wanted: a direct suite JSON file. Fix: recompute the fixture diff.`,
      )
    }
    const vendoredPath = path.join(fixtureDir, relPath)
    const previous = existsSync(vendoredPath)
      ? readFileSync(vendoredPath)
      : undefined
    const next =
      entry.kind === 'stale'
        ? undefined
        : readFileSync(path.join(checkoutDir, 'tests', relPath))
    return { __proto__: null, vendoredPath, previous, next }
  })
  try {
    for (let index = 0, { length } = changes; index < length; index += 1) {
      const { vendoredPath, next } = changes[index]!
      if (next === undefined) {
        await safeDelete(vendoredPath)
      } else {
        mkdirSync(path.dirname(vendoredPath), { recursive: true })
        writeFileSync(vendoredPath, next)
      }
    }
    finalize?.()
  } catch (error) {
    for (let index = 0, { length } = changes; index < length; index += 1) {
      const { vendoredPath, previous } = changes[index]!
      if (previous === undefined) {
        await safeDelete(vendoredPath)
      } else {
        writeFileSync(vendoredPath, previous)
      }
    }
    throw error
  }
}

export function selectSoakedRelease(
  value: unknown,
  options: { now?: number | undefined } = {},
): string | undefined {
  const { now = Date.now() } = options
  if (!Array.isArray(value)) {
    throw new Error('GitHub release metadata must be an array.')
  }
  const cutoff = now - SOAK_DAYS * MILLISECONDS_PER_DAY
  let selected: string | undefined
  for (let index = 0, { length } = value; index < length; index += 1) {
    const release: unknown = value[index]
    if (
      !isPlainObject(release) ||
      release['draft'] !== false ||
      release['prerelease'] !== false
    ) {
      continue
    }
    const tag = release['tag_name']
    const published = release['published_at']
    if (
      typeof tag !== 'string' ||
      typeof published !== 'string' ||
      !(Date.parse(published) <= cutoff) ||
      compare(tag, tag) !== 0
    ) {
      continue
    }
    if (!selected || compare(tag, selected) === 1) {
      selected = tag
    }
  }
  return selected
}

export async function bumpPin(pin: PurlSpecPin): Promise<PurlSpecPin> {
  const ownerRepo =
    /^https:\/\/github\.com\/(?<repository>[^/]+\/[^/]+?)(?:\.git)?$/.exec(
      pin.repository,
    )?.groups?.['repository']
  if (!ownerRepo) {
    throw new Error(
      `PURL release resolution requires a GitHub repository URL: ${pin.repository}`,
    )
  }
  const response = await spawn(
    'gh',
    [
      'api',
      `repos/${ownerRepo}/releases?per_page=100`,
      '--paginate',
      '--slurp',
    ],
    { cwd: REPO_ROOT, stdioString: true },
  )
  if (response.code !== 0) {
    throw new Error(
      `PURL release metadata failed with exit ${response.code}. ${response.stderr}`,
    )
  }
  const pages: unknown = JSON.parse(response.stdout)
  if (!Array.isArray(pages) || !pages.every(Array.isArray)) {
    throw new Error('Invalid paginated GitHub release response.')
  }
  const releaseTag = selectSoakedRelease(pages.flat())
  if (!releaseTag) {
    throw new Error(
      `No published PURL release has completed the ${SOAK_DAYS}-day soak.`,
    )
  }
  const remote = await git([
    'ls-remote',
    pin.repository,
    `refs/tags/${releaseTag}`,
    `refs/tags/${releaseTag}^{}`,
  ])
  const rows = remote.stdout.trim().split(/\r?\n/)
  const peeled = rows.find(row => row.endsWith('^{}')) ?? rows[0]
  const ref = /^[0-9a-f]{40}/.exec(peeled ?? '')?.[0]
  if (!ref) {
    throw new Error(
      `Cannot resolve published PURL release ${releaseTag} to an immutable commit.`,
    )
  }
  return { ...pin, ref, releaseTag }
}

async function preparePin(pin: PurlSpecPin, pinFile: string): Promise<void> {
  writeFileSync(pinFile, readFileSync(GITMODULES_PATH))
  if (!pin.releaseTag) {
    throw new Error('PURL pin update requires the selected release tag.')
  }
  await git([
    'config',
    '--file',
    pinFile,
    `submodule.${PURL_SPEC_UPSTREAM_RELATIVE_PATH}.branch`,
    pin.releaseTag,
  ])
  const result = await spawn(
    'pnpm',
    [
      'run',
      'gitmodules:hash',
      pinFile,
      '--set',
      PURL_SPEC_UPSTREAM_RELATIVE_PATH,
      pin.ref,
      '--label',
      `purl-spec-${pin.releaseTag}`,
    ],
    { cwd: REPO_ROOT, stdio: 'inherit' },
  )
  if (result.code !== 0) {
    throw new Error(
      `Cannot stamp purl-spec pin. Where: ${GITMODULES_PATH}. Saw: exit ${result.code}; wanted: matching SHA and archive hash. Fix: rerun gitmodules:hash with working upstream access.`,
    )
  }
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
  const previousPin = await readPin()
  let pin = previousPin
  if (bump) {
    const next = await bumpPin(pin)
    if (!quiet && next.ref !== pin.ref) {
      logger.log(
        `selected ${next.releaseTag}: ${pin.ref.slice(0, 12)} → ${next.ref.slice(0, 12)}`,
      )
    }
    pin = next
  }
  const checkoutDir = await materializePinnedSpec(pin)
  const drift = diffSuite(checkoutDir)
  if (!drift.length && pin.ref === previousPin.ref) {
    if (!quiet) {
      logger.log(`vendored suite matches purl-spec@${pin.ref.slice(0, 12)}.`)
    }
    return
  }
  if (check) {
    logger.error(
      `vendored purl-spec suite drifts from the pin in ${GITMODULES_PATH} ` +
        `(purl-spec@${pin.ref.slice(0, 12)}) at ${drift.length} path(s) under test/repo/common/fixture/purl-spec/:`,
    )
    for (const entry of drift) {
      logger.error(`  ${entry.kind}: ${entry.relPath}`)
    }
    logger.error('Fix: run `pnpm run sync-purl-spec`.')
    process.exitCode = 1
    return
  }
  if (pin.ref !== previousPin.ref) {
    mkdirSync(REPO_CACHE_DIR, { recursive: true })
    const stagingDir = mkdtempSync(path.join(REPO_CACHE_DIR, 'purl-spec-pin-'))
    try {
      const pinFile = path.join(stagingDir, '.gitmodules')
      await preparePin(pin, pinFile)
      await applySuite(checkoutDir, drift, {
        finalize() {
          renameSync(pinFile, GITMODULES_PATH)
        },
      })
    } finally {
      await safeDelete(stagingDir)
    }
  } else {
    await applySuite(checkoutDir, drift)
  }
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
const SCRIPT_META = {
  describe:
    'synchronizes published purl-spec fixtures and selects soak-cleared releases',
  help: 'Usage: pnpm sync-purl-spec [--check | --bump] [--quiet]\n--help, -h  Show command usage\n--describe  Show command purpose',
  json: 'result',
} as const

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
