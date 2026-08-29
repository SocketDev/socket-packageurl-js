#!/usr/bin/env node
/*
 * @file Publish from a clean git-archive snapshot, so a dirty working tree never
 *   reaches the registry. A tree can pick up uncommitted edits between the
 *   moment tests pass and the moment bytes are uploaded; this closes that window
 *   by exporting HEAD into a tmpdir and uploading from there.
 *
 *   The snapshot is a `git archive` of HEAD: the committed state, never the
 *   working tree. A file that appears after the snapshot cannot enter the
 *   upload, and the version comes from the committed package.json, so both the
 *   contents and the version are frozen at the moment the snapshot was taken.
 *
 *   WHAT THIS SCRIPT OWNS is the snapshot, and only that. The upload itself is
 *   `uploadNpmPackage` (registry-infra/npm/publish-command.mts) — the one npm
 *   invocation every fleet publish path shares, which owns the argv, the
 *   provenance decision, and the auth posture on both sides of the spawn. A
 *   second hand-rolled `npm publish` here would be a copy of that primitive, and
 *   a publish primitive that lives in two places is wrong in one of them.
 *
 *   Usage: node scripts/fleet/publish-from-snapshot.mts [--dry-run]
 *          --dry-run  run the upload in dry-run mode, uploading nothing
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { gitSync as runGit } from './_shared/git-exec.mts'
import { isMainModule } from './_shared/is-main-module.mts'
import { uploadNpmPackage } from './registry-infra/npm/publish-command.mts'
import { runMainAsync } from './_shared/run-main.mts'
import type { ScriptMeta } from './_shared/run-main.mts'
import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'

const logger = getDefaultLogger()

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
)

function gitStdout(args: readonly string[]): string {
  const r = runGit([...args], { cwd: REPO_ROOT })
  return String(r.stdout ?? '').trim()
}

export async function main(): Promise<number> {
  const dryRun = process.argv.includes('--dry-run')
  const head = gitStdout(['rev-parse', 'HEAD'])
  const shortSha = gitStdout(['rev-parse', '--short', 'HEAD'])

  logger.info(`snapshotting HEAD ${shortSha} into a tmpdir for a clean pack`)

  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'socket-lib-publish-'))
  try {
    // git archive exports the committed tree: no working-tree dirt.
    const archiveResult = runGit(['archive', '--format=tar', head], {
      cwd: REPO_ROOT,
      stdioString: false,
    })
    if (archiveResult.status !== 0) {
      logger.fail('git archive failed')
      return 1
    }
    // Unpack the archive into the tmpdir.
    const tarResult = spawnSync('tar', ['-x'], {
      cwd: tmpDir,
      input: archiveResult.stdout,
    })
    if (tarResult.status !== 0) {
      logger.fail('tar extract failed')
      return 1
    }

    // Read the version from the snapshot's package.json: frozen at HEAD.
    const pkg = JSON.parse(
      readFileSync(path.join(tmpDir, 'package.json'), 'utf8'),
    ) as { version: string; name: string }
    logger.info(`packed version: ${pkg.version} (${pkg.name})`)

    // THE fleet npm upload, against the snapshot dir. This script owns WHERE the
    // bytes come from — a git-archive of HEAD rather than the working tree —
    // and nothing else. Which argv uploads them, whether provenance is allowed,
    // and the auth posture on both sides of the spawn belong to
    // `uploadNpmPackage`, the one invocation every fleet publish path shares.
    // A hand-rolled `npm publish` here would be a second copy of that primitive,
    // and a publish primitive that lives in two places is wrong in one of them.
    const upload = await uploadNpmPackage({ cwd: tmpDir, dryRun })
    // `postureOk`, not the exit code. A preflight refusal returns 0 because no
    // command ran, and a token-backed upload whose OIDC exchange failed can exit
    // 0 while having published nothing verifiable — both are failures wearing a
    // success, and this is the field that tells them apart.
    if (!upload.postureOk) {
      logger.fail('publish refused by the fleet auth posture')
      return upload.code === 0 ? 1 : upload.code
    }
    if (upload.code !== 0) {
      logger.fail('npm upload failed')
      return upload.code
    }
    logger.success(
      dryRun
        ? `--dry-run: ${pkg.version} verified from the snapshot, nothing uploaded`
        : `published ${pkg.version}`,
    )
    return 0
  } finally {
    safeDeleteSync(tmpDir)
  }
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'pack and publish from a clean git-archive snapshot so a dirty working tree never pollutes the tarball',
  help: `Usage: node scripts/fleet/publish-from-snapshot.mts [--dry-run]

  --dry-run  pack and verify the tarball without publishing`,
}

/* c8 ignore start - entrypoint guard */
if (isMainModule(import.meta.url)) {
  runMainAsync(main, SCRIPT_META)
}
/* c8 ignore stop */
