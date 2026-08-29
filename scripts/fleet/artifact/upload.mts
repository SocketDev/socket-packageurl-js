/**
 * @file Fleet artifact upload CLI - the native port of the
 *   `actions/upload-artifact` step over the first-party artifact-service client
 *   (./client.mts). Zips the given paths and uploads them under one artifact
 *   name. A missing path, an empty set, or any service failure is loud - What /
 *   Where / Saw-vs-wanted / Fix and a non-zero exit. Usage: node
 *   scripts/fleet/artifact/upload.mts --name <name> --path <path>...
 */

import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import { uploadArtifact } from './client.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

export interface ArtifactUploadArgs {
  name: string
  paths: string[]
  ifNoFilesFound: 'error' | 'ignore'
}

/**
 * Parse the CLI args: --name <name> (required) and --path <path> (repeatable,
 * at least one). Returns undefined + a usage string when unusable.
 */
export function parseUploadArgs(argv: readonly string[]): {
  args: ArtifactUploadArgs | undefined
  usageError: string | undefined
} {
  let name: string | undefined
  const paths: string[] = []
  let ifNoFilesFound: 'error' | 'ignore' = 'error'
  for (let i = 0, { length } = argv; i < length; i += 1) {
    const arg = argv[i]!
    if (arg === '--name') {
      name = argv[i + 1]
      i += 1
    } else if (arg === '--path') {
      const value = argv[i + 1]
      if (value !== undefined) {
        paths.push(value)
      }
      i += 1
    } else if (arg === '--if-no-files-found') {
      const value = argv[i + 1]
      if (value === 'error' || value === 'ignore') {
        ifNoFilesFound = value
      }
      i += 1
    }
  }
  if (!name) {
    return {
      args: undefined,
      usageError:
        'What: --name names the artifact to upload. Where: artifact/upload.mts. Saw: --name absent; wanted --name <name>. Fix: pass --name <name>.',
    }
  }
  if (paths.length === 0) {
    return {
      args: undefined,
      usageError:
        'What: --path names a file or directory to upload. Where: artifact/upload.mts. Saw: no --path; wanted at least one --path <path>. Fix: pass --path <path> for every path to include.',
    }
  }
  return { args: { name, paths, ifNoFilesFound }, usageError: undefined }
}

/**
 * Run the upload: parse argv, upload. Returns the process exit code.
 */
export async function runArtifactUpload(
  argv: readonly string[],
): Promise<number> {
  const { args, usageError } = parseUploadArgs(argv)
  if (!args) {
    logger.error(usageError ?? 'Unusable arguments.')
    return 1
  }
  try {
    const artifactId = await uploadArtifact(args.name, args.paths)
    logger.log(`Artifact uploaded: ${args.name} (id ${artifactId})`)
    return 0
  } catch (e) {
    if (
      args.ifNoFilesFound === 'ignore' &&
      errorMessage(e)?.includes('No files to upload')
    ) {
      logger.log(
        `Artifact skipped: ${args.name} (no files, --if-no-files-found=ignore)`,
      )
      return 0
    }
    logger.error(errorMessage(e))
    return 1
  }
}

const SCRIPT_META: ScriptMeta = {
  describe: 'uploads the given paths as one named GitHub Actions artifact',
  help: `Usage: node scripts/fleet/artifact/upload.mts --name <name> --path <path>...

  --name <name>  the artifact name to upload under (required)
  --path <path>  a file or directory to include (repeatable)`,
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  runMain(() => runArtifactUpload(process.argv.slice(2)), SCRIPT_META)
}
/* c8 ignore stop */
