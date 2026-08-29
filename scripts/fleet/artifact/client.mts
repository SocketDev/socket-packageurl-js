/**
 * @file First-party GitHub Actions artifact-service client - the v2 twirp
 *   protocol the `@actions/artifact` npm package speaks, reimplemented over
 *   socket-lib http + spawn so the fleet carries no @actions/artifact
 *   dependency (and none of its @azure/* + protobuf tree). v2-only by design:
 *   ACTIONS_RESULTS_URL and ACTIONS_RUNTIME_TOKEN are always injected on
 *   github.com runners - a missing variable is a loud error, never a v1
 *   fallback. This file owns the flows: uploadArtifact zips the staged paths,
 *   creates the container, PUTs the zip to the signed Azure URL, and finalizes
 *   with the size + sha256 digest; downloadArtifact resolves the signed URL,
 *   fetches the zip, and writes the entries back out. It composes two leaves it
 *   re-exports in full: ./twirp.mts (service config, backend ids, wire
 *   protocol) and ./zip.mts (the minimal zip writer + reader). Consumers import
 *   from this file only. Service errors THROW - the CLIs own the exit code.
 */

export * from './twirp.mts'
export * from './zip.mts'

import crypto from 'node:crypto'
import {
  createReadStream,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'
import { httpRequest } from '@socketsecurity/lib-stable/http-request'
import { httpDownload } from '@socketsecurity/lib-stable/http-request/download'

import {
  artifactTwirpPost,
  buildCreateArtifactRequest,
  buildFinalizeArtifactRequest,
  buildGetSignedArtifactUrlRequest,
  buildListArtifactsRequest,
  getBackendIdsFromToken,
  readArtifactServiceConfig,
  readCreateArtifactResponse,
  readFinalizeArtifactResponse,
  readGetSignedArtifactUrlResponse,
  readListArtifactsResponse,
} from './twirp.mts'
import { createZipArchive, extractZipArchive } from './zip.mts'

import type { ArtifactListEntry, BackendIds } from './twirp.mts'
import type { ZipEntry } from './zip.mts'

// Azure Put Blob accepts a single upload up to 5000 MiB; the client uploads in
// ONE put (the chunked block upload the official action does is an
// optimization, not a protocol requirement), so a larger archive is a loud error.
export const ARTIFACT_SINGLE_UPLOAD_MAX_BYTES = 5 * 1024 * 1024 * 1024

// Archive transfer timeouts - generous because a staged set of native binaries
// runs to tens of MB.
export const ARTIFACT_DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000
export const ARTIFACT_UPLOAD_TIMEOUT_MS = 30 * 60 * 1000

/**
 * The common ancestor directory of every path - the root zip entry names are
 * relative to. For a single directory it is that directory; for a single file
 * it is the file's parent (so the entry names to the basename). Pure.
 */
export function commonAncestorDir(paths: readonly string[]): string {
  const dirs = paths.map(p => (statSync(p).isDirectory() ? p : path.dirname(p)))
  if (dirs.length === 0) {
    return '.'
  }
  let ancestor = path.resolve(dirs[0]!)
  const rest = dirs.slice(1)
  for (let i = 0, { length } = rest; i < length; i += 1) {
    const resolved = path.resolve(rest[i]!)
    while (!resolved.startsWith(ancestor + path.sep) && resolved !== ancestor) {
      const parent = path.dirname(ancestor)
      if (parent === ancestor) {
        break
      }
      ancestor = parent
    }
  }
  return ancestor
}

/**
 * Walk the paths and collect every regular file as a zip entry named relative
 * to the common ancestor. A path must exist - a missing path is a loud error
 * (the `if-no-files-found: error` contract the workflow declares).
 */
export function collectZipEntries(paths: readonly string[]): ZipEntry[] {
  const root = commonAncestorDir(paths)
  const entries: ZipEntry[] = []
  const visit = (absPath: string): void => {
    const stat = statSync(absPath)
    if (stat.isDirectory()) {
      for (const child of readdirSync(absPath)) {
        visit(path.join(absPath, child))
      }
      return
    }
    if (!stat.isFile()) {
      return
    }
    const rel = path.relative(root, absPath).split(path.sep).join('/')
    entries.push({ name: rel, data: readFileSync(absPath) })
  }
  for (const p of paths) {
    visit(p)
  }
  if (entries.length === 0) {
    throw new Error(
      `No files to upload. Where: the paths argument. Saw: no regular files under ${paths.join(', ')}; wanted at least one file. Fix: confirm the build produced its output before uploading.`,
    )
  }
  return entries
}

/**
 * Upload the zip to the signed Azure blob URL in one PUT - the SAS URL carries
 * the auth, `x-ms-blob-type: BlockBlob` names the blob kind.
 */
export async function uploadArtifactZip(
  signedUploadUrl: string,
  archivePath: string,
  sizeBytes: number,
): Promise<void> {
  if (sizeBytes > ARTIFACT_SINGLE_UPLOAD_MAX_BYTES) {
    throw new Error(
      `The artifact archive is too large for a single upload. Where: ${archivePath}. Saw: ${sizeBytes} bytes; wanted at most ${ARTIFACT_SINGLE_UPLOAD_MAX_BYTES} (the Azure single-put limit). Fix: upload fewer/smaller files, or split the set into multiple artifacts.`,
    )
  }
  await httpRequest(signedUploadUrl, {
    body: createReadStream(archivePath),
    headers: {
      'content-length': String(sizeBytes),
      'x-ms-blob-type': 'BlockBlob',
    },
    method: 'PUT',
    throwOnError: true,
    timeout: ARTIFACT_UPLOAD_TIMEOUT_MS,
  })
}

/**
 * Upload the staged paths as one named artifact. Returns the service's numeric
 * artifact id. A missing path, an empty set, or any service failure throws -
 * the CLI owns the exit code.
 */
export async function uploadArtifact(
  name: string,
  paths: readonly string[],
): Promise<number> {
  const config = readArtifactServiceConfig()
  const ids = getBackendIdsFromToken(config.token)
  const entries = collectZipEntries(paths)
  const zip = createZipArchive(entries)
  const sha256Hex = crypto.createHash('sha256').update(zip).digest('hex')
  const archivePath = path.join(
    process.env['RUNNER_TEMP'] ?? '.',
    `artifact-${name}.zip`,
  )
  writeFileSync(archivePath, zip)
  try {
    const created = readCreateArtifactResponse(
      await artifactTwirpPost(
        config,
        'CreateArtifact',
        buildCreateArtifactRequest(ids, name),
      ),
    )
    if (!created.ok || !created.signedUploadUrl) {
      throw new Error(
        `Creating the artifact container failed. Where: the CreateArtifact twirp call for '${name}'. Saw: ok=${created.ok} with no signed upload URL; wanted an acknowledged container. Fix: re-run the job; if it persists, check GitHub Actions artifact service status.`,
      )
    }
    await uploadArtifactZip(created.signedUploadUrl, archivePath, zip.length)
    const finalized = readFinalizeArtifactResponse(
      await artifactTwirpPost(
        config,
        'FinalizeArtifact',
        buildFinalizeArtifactRequest(ids, name, zip.length, sha256Hex),
      ),
    )
    if (!finalized.ok || finalized.artifactId === undefined) {
      throw new Error(
        `Finalizing the artifact upload failed. Where: the FinalizeArtifact twirp call for '${name}'. Saw: ok=${finalized.ok}, artifactId=${finalized.artifactId}; wanted an acknowledged entry. Fix: re-run the job; if it persists, check GitHub Actions artifact service status.`,
      )
    }
    return finalized.artifactId
  } finally {
    // The zip is a build artifact in RUNNER_TEMP; best-effort cleanup, never
    // a failure of its own.
    try {
      safeDeleteSync(archivePath)
    } catch {}
  }
}

/**
 * Resolve the signed download URL for a named artifact in the current run, via
 * the backend ids decoded from the token.
 */
export async function getSignedArtifactUrl(
  ids: BackendIds,
  name: string,
): Promise<string> {
  const config = readArtifactServiceConfig()
  const resolved = readGetSignedArtifactUrlResponse(
    await artifactTwirpPost(
      config,
      'GetSignedArtifactURL',
      buildGetSignedArtifactUrlRequest(ids, name),
    ),
  )
  if (!resolved.signedUrl) {
    throw new Error(
      `No artifact named '${name}' in this run. Where: the GetSignedArtifactURL twirp call. Saw: no signed URL back; wanted the artifact an earlier job uploaded. Fix: confirm the upload job completed and used the same artifact name.`,
    )
  }
  return resolved.signedUrl
}

/**
 * Assert an extracted zip entry name is safe to write under dest — the standard
 * zip-slip defense. Rejects absolute paths and any name with a `..` segment,
 * then confirms the resolved path stays inside dest. The threat model is a
 * compromised upstream job that uploaded a hostile artifact (an entry named
 * `../../../../etc/cron.d/payload` would otherwise write outside dest); the
 * same trust boundary the official `actions/download-artifact` defends against.
 * Pure + exported so the guard is unit-testable without the network flow.
 */
export function assertEntryWithinDest(name: string, dest: string): void {
  if (path.isAbsolute(name)) {
    throw new Error(
      `Refusing to extract an artifact entry with an absolute path. Where: downloadArtifact entry '${name}'. Saw: an absolute entry name; wanted a relative path under the destination. Fix: re-upload the artifact with relative entry paths; a hostile or corrupted upstream job is the threat model.`,
    )
  }
  // Reject any `..` segment even when it does not escape (e.g. `a/../b`):
  // traversal segments in an archive name are never legitimate, and refusing
  // them outright is defense-in-depth alongside the containment check below.
  if (name.split('/').includes('..')) {
    throw new Error(
      `Refusing to extract an artifact entry with a parent-directory segment. Where: downloadArtifact entry '${name}'. Saw: a '..' segment in the entry name; wanted a relative path with no traversal. Fix: re-upload the artifact; a hostile or corrupted upstream job is the threat model (zip-slip).`,
    )
  }
  const resolvedDest = path.resolve(dest)
  const outPath = path.resolve(resolvedDest, name)
  if (
    outPath !== resolvedDest &&
    !outPath.startsWith(resolvedDest + path.sep)
  ) {
    throw new Error(
      `Refusing to extract an artifact entry that escapes the destination (zip-slip). Where: downloadArtifact entry '${name}'. Saw: a path that resolves to '${outPath}', outside '${resolvedDest}'; wanted a path inside it. Fix: re-upload the artifact; a hostile or corrupted upstream job is the threat model.`,
    )
  }
}

/**
 * Download a named artifact and write its entries under dest, preserving the
 * zip's relative paths. Returns the entry names written. Each entry name is
 * validated against zip-slip (see assertEntryWithinDest) before any file is
 * written — a hostile or corrupted upstream artifact is rejected loudly rather
 * than allowed to write outside dest.
 */
export interface ListArtifactsOptions {
  /**
   * Restrict the listing to this artifact name. Omitted lists everything the
   * run uploaded.
   */
  name?: string | undefined
}

export async function listArtifacts(
  ids: BackendIds,
  options?: ListArtifactsOptions | undefined,
): Promise<ArtifactListEntry[]> {
  const { name } = { __proto__: null, ...options } as ListArtifactsOptions
  const config = readArtifactServiceConfig()
  const response = readListArtifactsResponse(
    await artifactTwirpPost(
      config,
      'ListArtifacts',
      buildListArtifactsRequest(ids, { nameFilter: name }),
    ),
  )
  return response.artifacts
}

/**
 * The backend ids that resolve `name`, which are the UPLOADING job's, not this
 * one's.
 *
 * `GetSignedArtifactURL` is scoped by both ids, so a consumer job asking with
 * its own pair gets a 404 for an artifact a sibling job uploaded - which is
 * every cross-job download, the whole point of uploading one. ListArtifacts is
 * scoped by the RUN, so it sees the sibling's artifact and reports the ids that
 * resolve it. Falls back to this job's ids when the response omits them, which
 * keeps a same-job download working.
 *
 * Revisit at socket-lib v7.0: this list-then-resolve dance is the artifact
 * protocol's shape, not ours, so it belongs behind a lib helper once the http
 * surface there is settled. Kept local until then because the fleet's release
 * path cannot wait on a lib bump.
 */
export async function resolveArtifactOwnerIds(
  ids: BackendIds,
  name: string,
): Promise<BackendIds> {
  const artifacts = await listArtifacts(ids, { name })
  const match = artifacts.find(entry => entry.name === name)
  if (!match) {
    throw new Error(
      `No artifact named '${name}' in this run. Where: the ListArtifacts twirp call. Saw: ${artifacts.length} artifact(s), none matching; wanted the one an earlier job uploaded. Fix: confirm the upload job completed and used the same artifact name.`,
    )
  }
  return {
    workflowJobRunBackendId:
      match.workflowJobRunBackendId ?? ids.workflowJobRunBackendId,
    workflowRunBackendId:
      match.workflowRunBackendId ?? ids.workflowRunBackendId,
  }
}

export async function downloadArtifact(
  name: string,
  dest: string,
): Promise<string[]> {
  const config = readArtifactServiceConfig()
  const ids = getBackendIdsFromToken(config.token)
  const ownerIds = await resolveArtifactOwnerIds(ids, name)
  const signedUrl = await getSignedArtifactUrl(ownerIds, name)
  const archivePath = path.join(
    process.env['RUNNER_TEMP'] ?? '.',
    `artifact-${name}.zip`,
  )
  await httpDownload(signedUrl, archivePath, {
    retries: 1,
    timeout: ARTIFACT_DOWNLOAD_TIMEOUT_MS,
  })
  const zip = readFileSync(archivePath)
  const entries = extractZipArchive(zip)
  const written: string[] = []
  const destResolved = path.resolve(dest)
  for (const entry of entries) {
    assertEntryWithinDest(entry.name, dest)
    const outPath = path.join(dest, entry.name)
    const outResolved = path.resolve(outPath)
    if (
      outResolved !== destResolved &&
      !outResolved.startsWith(destResolved + path.sep)
    ) {
      throw new Error(
        `What: zip-slip — an artifact entry resolves outside the destination.\n` +
          `Where: downloadArtifact -> extractZipArchive entry '${entry.name}'.\n` +
          `Saw: ${outResolved}; wanted a path under ${destResolved}.\n` +
          `Fix: re-download the artifact; if it persists, the upstream job may have uploaded a hostile zip.\n`,
      )
    }
    mkdirSync(path.dirname(outPath), { recursive: true })
    writeFileSync(outPath, entry.data)
    written.push(entry.name)
  }
  return written
}
