#!/usr/bin/env node
/**
 * @file Clone an external GitHub repo into the fleet's shared repo-clones dir
 *   with the mandatory shallow flags baked in. The fleet rule (CLAUDE.md "git
 *   clone"): `--depth=1` + `--single-branch` + `--filter=blob:none` on every
 *   clone, and submodules initialized individually (never `git submodule update
 *   --init` which pulls ALL of them). This script IS those defaults — the flags
 *   are not on the command line, they are in the .mts, so they cannot be
 *   forgotten. The target resolves via `getSocketRepoClonesDir()` (1 path, 1
 *   reference). If the clone already exists, the script skips and prints the
 *   path (idempotent — verify before acting). Usage: node
 *   scripts/fleet/clone-repo.mts <github-url-or-org/repo> node
 *   scripts/fleet/clone-repo.mts <org/repo> --submodule <path> [--submodule
 *   <path>...] Examples: node scripts/fleet/clone-repo.mts appium/appium node
 *   scripts/fleet/clone-repo.mts v8/v8 --submodule test/test262 node
 *   scripts/fleet/clone-repo.mts https://github.com/NomicFoundation/hardhat.
 */

import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { gitSync } from './_shared/git-exec.mts'

import { isMainModule } from './_shared/is-main-module.mts'
import { runMain } from './_shared/run-main.mts'
import type { ScriptMeta } from './_shared/run-main.mts'
import { getSocketRepoClonesDir } from './paths.mts'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

const logger = getDefaultLogger()

export interface CloneRepoArgs {
  url: string
  slug: string
  submodules: string[]
}

/**
 * Parse the repo input + --submodule flags. Accepts:
 *
 * - `https://github.com/<org>/<repo>`
 * - `git@github.com:<org>/<repo>`
 * - `<org>/<repo>` Derives the clone slug `<org>-<repo>` and the full clone URL.
 */
export function parseCloneArgs(
  argv: readonly string[],
): CloneRepoArgs | undefined {
  let input = ''
  const submodules: string[] = []
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!
    if (a === '--submodule') {
      const sub = argv[(i += 1)]
      if (sub) {
        submodules.push(sub)
      }
    } else if (!a.startsWith('-')) {
      input = a
    }
  }
  if (!input) {
    return undefined
  }
  const slug = repoSlug(input)
  if (!slug) {
    return undefined
  }
  const url =
    input.includes('://') || input.includes('@')
      ? input
      : `https://github.com/${input}`
  return { url, slug, submodules }
}

/**
 * Derive `<org>-<repo>` from a GitHub URL or `org/repo` shorthand. Returns
 * undefined if the input does not resolve to an org/repo pair.
 */
export function repoSlug(input: string): string | undefined {
  // https://github.com/<org>/<repo> or https://github.com/<org>/<repo>.git
  const httpsMatch = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(
    normalizePath(input),
  )
  if (httpsMatch) {
    return `${httpsMatch[1]}-${httpsMatch[2]}`
  }
  // git@github.com:<org>/<repo>
  const sshMatch = /github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/.exec(
    normalizePath(input),
  )
  if (sshMatch) {
    return `${sshMatch[1]}-${sshMatch[2]}`
  }
  // bare org/repo
  const bareMatch = /^([^/\s]+)\/([^/\s]+?)(?:\.git)?$/.exec(
    normalizePath(input),
  )
  if (bareMatch) {
    return `${bareMatch[1]}-${bareMatch[2]}`
  }
  return undefined
}

/**
 * True when `dir` is an existing git repository (has a `.git` dir or file).
 */
function isGitRepo(dir: string): boolean {
  const r = gitSync(['-C', dir, 'rev-parse', '--git-dir'], {
    timeout: 5000,
  })
  return r.status === 0
}

/**
 * Clone an external GitHub repo into the fleet's shared repo-clones dir with
 * the mandatory shallow flags. Idempotent: if the clone exists, skips and
 * prints the path. Optionally sparse-inits named submodules individually.
 */
export async function main(): Promise<void> {
  const args = parseCloneArgs(process.argv.slice(2))
  if (!args) {
    logger.fail(
      'Usage: node scripts/fleet/clone-repo.mts <github-url-or-org/repo> [--submodule <path>...]',
    )
    process.exitCode = 2
    return
  }
  const target = path.join(getSocketRepoClonesDir(), args.slug)

  // Verify before acting: if the clone already exists, skip + print the path.
  if (isGitRepo(target)) {
    logger.info(`clone already exists: ${target}`)
    process.stdout.write(`${target}\n`)
    return
  }

  // Clone with the mandatory fleet defaults baked in.
  logger.info(
    `git clone --depth=1 --single-branch --filter=blob:none ${args.url} ${target}`,
  )
  const clone = spawnSync(
    'git',
    [
      'clone',
      '--depth=1',
      '--single-branch',
      '--filter=blob:none',
      args.url,
      target,
    ],
    { stdio: 'inherit' },
  )
  if (clone.status !== 0) {
    logger.fail(`git clone failed (exit ${clone.status}).`)
    process.exitCode = 1
    return
  }

  // Sparse submodule init: each named submodule individually, never all.
  for (let i = 0, { length } = args.submodules; i < length; i += 1) {
    const sub = args.submodules[i]!
    logger.info(
      `git submodule update --init --depth=1 --single-branch -- ${sub}`,
    )
    const subResult = spawnSync(
      'git',
      [
        '-C',
        target,
        'submodule',
        'update',
        '--init',
        '--depth=1',
        '--single-branch',
        '--',
        sub,
      ],
      { stdio: 'inherit' },
    )
    if (subResult.status !== 0) {
      logger.warn(
        `submodule init failed for ${sub} (exit ${subResult.status}).`,
      )
    }
  }

  process.stdout.write(`${target}\n`)
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'clone an external GitHub repo into the fleet repo-clones dir with shallow + single-branch + blobless defaults baked in',
  help: `Usage: node scripts/fleet/clone-repo.mts <github-url-or-org/repo> [--submodule <path>...]

  <org/repo>              clone https://github.com/<org>/<repo> (shallow, single-branch, blobless)
  --submodule <path>      sparse-init one named submodule (repeatable; never inits ALL submodules)

The mandatory flags (--depth=1 --single-branch --filter=blob:none) are in the
script, not on the command line, so they cannot be forgotten. The target
resolves via getSocketRepoClonesDir() (~/.socket/_wheelhouse/repo-clones/<org>-<repo>).
If the clone already exists, the script skips and prints the path (idempotent).`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
