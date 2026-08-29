/**
 * @file Fleet artifact download CLI - the native port of the
 *   `actions/download-artifact` step over the first-party artifact-service
 *   client (./client.mts). Downloads one named artifact from the current run
 *   and writes its entries under the given directory. A missing artifact or any
 *   service failure is loud - What / Where / Saw-vs-wanted / Fix and a non-zero
 *   exit. Usage: node scripts/fleet/artifact/download.mts --name <name> --path
 *   <dir>
 */

import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import {
  downloadArtifact,
  getBackendIdsFromToken,
  listArtifacts,
  readArtifactServiceConfig,
} from './client.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

export interface ArtifactDownloadArgs {
  name: string
  dest: string
}

/**
 * Parse the CLI args: `--path <dir>` (required) and `--name <name>`
 * (optional).
 *
 * An ABSENT `--name` means every artifact in the run, each into its own
 * `<dir>/<name>/` subdirectory. That is actions/download-artifact's behaviour
 * for a nameless download, and a publish job collecting one artifact per
 * build-matrix leg has no list of names to pass - the legs are the list.
 */
export function parseDownloadArgs(argv: readonly string[]): {
  args: { readonly dest: string; readonly name: string | undefined } | undefined
  usageError: string | undefined
} {
  let name: string | undefined
  let dest: string | undefined
  for (let i = 0, { length } = argv; i < length; i += 1) {
    const arg = argv[i]!
    if (arg === '--name') {
      name = argv[i + 1]
      i += 1
    } else if (arg === '--path') {
      dest = argv[i + 1]
      i += 1
    }
  }
  if (!dest) {
    return {
      args: undefined,
      usageError:
        'What: --path names the directory to download into. Where: artifact/download.mts. Saw: --path absent; wanted --path <dir>. Fix: pass --path <dir>.',
    }
  }
  return { args: { dest, name }, usageError: undefined }
}

/**
 * Run the download: parse argv, download. Returns the process exit code.
 */
export async function runArtifactDownload(
  argv: readonly string[],
): Promise<number> {
  const { args, usageError } = parseDownloadArgs(argv)
  if (!args) {
    logger.error(usageError ?? 'Unusable arguments.')
    return 1
  }
  try {
    if (args.name !== undefined) {
      const written = await downloadArtifact(args.name, args.dest)
      logger.log(
        `Artifact downloaded: ${args.name} (${written.length} file(s))`,
      )
      return 0
    }
    const config = readArtifactServiceConfig()
    const entries = await listArtifacts(getBackendIdsFromToken(config.token))
    if (entries.length === 0) {
      logger.log('No artifacts in this run; nothing downloaded.')
      return 0
    }
    for (let i = 0, { length } = entries; i < length; i += 1) {
      const { name } = entries[i]!
      // Each under its own subdirectory, matching the nameless upstream
      // behaviour. A flat merge would collide when two legs upload the same
      // relative path, which a per-platform matrix does by construction.
      // eslint-disable-next-line no-await-in-loop -- sequential by design
      const written = await downloadArtifact(name, path.join(args.dest, name))
      logger.log(`Artifact downloaded: ${name} (${written.length} file(s))`)
    }
    return 0
  } catch (e) {
    logger.error(errorMessage(e))
    return 1
  }
}

const SCRIPT_META: ScriptMeta = {
  describe: 'downloads one named GitHub Actions artifact into a directory',
  help: `Usage: node scripts/fleet/artifact/download.mts --name <name> --path <dir>

  --name <name>  the artifact name to download; omit for every artifact
  --path <dir>   the directory to write the entries under (required)`,
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  runMain(() => runArtifactDownload(process.argv.slice(2)), SCRIPT_META)
}
/* c8 ignore stop */
