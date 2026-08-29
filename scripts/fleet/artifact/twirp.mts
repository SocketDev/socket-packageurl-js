/**
 * @file Wire-protocol leaf of the first-party artifact-service client - the v2
 *   twirp transport for the GitHub Actions ArtifactService, reimplemented over
 *   socket-lib http so the fleet carries no @actions/artifact dependency (and
 *   none of its @azure/* + protobuf tree). v2-only by design: the fleet runs on
 *   github.com runners, where ACTIONS_RESULTS_URL and ACTIONS_RUNTIME_TOKEN are
 *   always injected - a missing variable is a loud error, never a v1 fallback.
 *   The wire contract (twirp method names, canonical proto3 JSON camelCase
 *   fields, int64 as a
 *   JSON string, the {value: ...} StringValue wrappers, version 7, the
 *   application/zip mime, the sha256: finalize hash, and the backend-ids-from-
 *   token-JWT decode) is copied from @actions/artifact, the behavioral
 *   reference pinned at upstream/actions-toolkit. ./client.mts composes these
 *   into the upload/download flows and re-exports everything here, so consumers
 *   import from client.mts only. Service errors THROW - the CLIs own the exit
 *   code.
 */

import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import {
  httpJson,
  HttpResponseError,
} from '@socketsecurity/lib-stable/http-request'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  readActionsResultsUrl,
  readActionsRuntimeToken,
} from '../_shared/actions-runtime.mts'

import type { HttpResponse } from '@socketsecurity/lib-stable/http-request'

const logger = getDefaultLogger()

// The twirp service every artifact RPC posts to:
// POST {ACTIONS_RESULTS_URL}/twirp/{service}/{method}.
export const ARTIFACT_TWIRP_SERVICE =
  'github.actions.results.api.v1.ArtifactService'

// Twirp retry posture mirrors the cache client's: a few attempts with a
// seconds-scale delay, 5xx-only.
export const ARTIFACT_TWIRP_RETRIES = 2
export const ARTIFACT_TWIRP_RETRY_DELAY_MS = 3000

// The artifact-format version every CreateArtifactRequest carries (v4-era
// artifacts are version 7 - the digest-bearing layout).
export const ARTIFACT_VERSION = 7

// The mime every uploaded artifact container declares.
export const ARTIFACT_ZIP_MIME_TYPE = 'application/zip'

export interface ArtifactServiceConfig {
  baseUrl: string
  token: string
}

/**
 * Read the v2 results-service wiring from the environment. Throws loud on a
 * missing variable - the client is v2-only, with no v1 fallback to hide behind.
 */
export function readArtifactServiceConfig(
  env: Record<string, string | undefined> = process.env,
): ArtifactServiceConfig {
  return {
    baseUrl: readActionsResultsUrl(env),
    token: readActionsRuntimeToken(env),
  }
}

/**
 * The twirp endpoint URL for one ArtifactService method.
 */
export function artifactTwirpUrl(baseUrl: string, method: string): string {
  return new URL(`/twirp/${ARTIFACT_TWIRP_SERVICE}/${method}`, baseUrl).href
}

export interface BackendIds {
  workflowRunBackendId: string
  workflowJobRunBackendId: string
}

const INVALID_BACKEND_IDS_ERROR =
  'Failed to get backend IDs: the ACTIONS_RUNTIME_TOKEN JWT is invalid or missing its Actions.Results scope. Where: the token the runner injects. Saw: no "Actions.Results:<run-id>:<job-id>" scope in the scp claim; wanted the two backend ids the artifact requests carry. Fix: run this inside a GitHub Actions job - the runner sets the token automatically.'

/**
 * Decode the workflow-run and job-run backend ids out of the runtime token
 * JWT. The token's scp claim is a space-separated scope list; the
 * `Actions.Results:<run-id>:<job-id>` scope carries both ids. No jwt-decode
 * dependency - the JWT payload is base64url-encoded JSON.
 */
export function getBackendIdsFromToken(token: string): BackendIds {
  const parts = token.split('.')
  const payload = parts[1]
  let scp: unknown
  if (payload !== undefined) {
    try {
      const decoded = JSON.parse(
        Buffer.from(payload, 'base64url').toString(),
      ) as { scp?: unknown | undefined }
      scp = decoded.scp
    } catch {
      scp = undefined
    }
  }
  if (typeof scp !== 'string') {
    throw new Error(INVALID_BACKEND_IDS_ERROR)
  }
  const scopes = scp.split(' ')
  for (let i = 0, { length } = scopes; i < length; i += 1) {
    const scopeParts = scopes[i]!.split(':')
    if (scopeParts[0] !== 'Actions.Results') {
      continue
    }
    if (scopeParts.length !== 3) {
      throw new Error(INVALID_BACKEND_IDS_ERROR)
    }
    const workflowRunBackendId = scopeParts[1]!
    const workflowJobRunBackendId = scopeParts[2]!
    return { workflowRunBackendId, workflowJobRunBackendId }
  }
  throw new Error(INVALID_BACKEND_IDS_ERROR)
}

// Request field names are canonical proto3 JSON, which is camelCase - the
// service decoder rejects the snake_case proto names with "malformed: the json
// request could not be decoded". int64 fields travel as JSON strings, optional
// proto messages ride as {value: ...} wrappers, and empty optionals are omitted
// (emitDefaultValues: false).
export interface CreateArtifactRequest {
  workflow_run_backend_id: string
  workflow_job_run_backend_id: string
  name: string
  version: number
  mime_type?: string | undefined
}

export interface CreateArtifactResponse {
  ok: boolean
  signedUploadUrl: string | undefined
}

export interface FinalizeArtifactRequest {
  workflow_run_backend_id: string
  workflow_job_run_backend_id: string
  name: string
  size: string
  hash?: string | undefined
}

export interface FinalizeArtifactResponse {
  ok: boolean
  artifactId: number | undefined
}

export interface GetSignedArtifactUrlRequest {
  workflow_run_backend_id: string
  workflow_job_run_backend_id: string
  name: string
}

export interface GetSignedArtifactUrlResponse {
  signedUrl: string | undefined
}

export interface ListArtifactsRequest {
  workflow_run_backend_id: string
  workflow_job_run_backend_id: string
  name_filter?: string | undefined
}

export interface ArtifactListEntry {
  databaseId: string | undefined
  name: string
  size: string | undefined
  // The backend ids of the job that UPLOADED this artifact. A consumer job's
  // own ids do not resolve someone else's artifact, so a cross-job download
  // has to carry these through from the list response.
  workflowJobRunBackendId: string | undefined
  workflowRunBackendId: string | undefined
}

export interface ListArtifactsResponse {
  artifacts: ArtifactListEntry[]
}

export function buildCreateArtifactRequest(
  ids: BackendIds,
  name: string,
): CreateArtifactRequest {
  return {
    workflow_run_backend_id: ids.workflowRunBackendId,
    workflow_job_run_backend_id: ids.workflowJobRunBackendId,
    name,
    version: ARTIFACT_VERSION,
    mime_type: ARTIFACT_ZIP_MIME_TYPE,
  }
}

export function buildFinalizeArtifactRequest(
  ids: BackendIds,
  name: string,
  sizeBytes: number,
  sha256Hex: string,
): FinalizeArtifactRequest {
  return {
    workflow_run_backend_id: ids.workflowRunBackendId,
    workflow_job_run_backend_id: ids.workflowJobRunBackendId,
    name,
    size: String(sizeBytes),
    hash: `sha256:${sha256Hex}`,
  }
}

export function buildGetSignedArtifactUrlRequest(
  ids: BackendIds,
  name: string,
): GetSignedArtifactUrlRequest {
  return {
    workflow_run_backend_id: ids.workflowRunBackendId,
    workflow_job_run_backend_id: ids.workflowJobRunBackendId,
    name,
  }
}

export function buildListArtifactsRequest(
  ids: BackendIds,
  options?: { nameFilter?: string | undefined } | undefined,
): ListArtifactsRequest {
  const { nameFilter } = { __proto__: null, ...options } as {
    nameFilter?: string | undefined
  }
  const request: ListArtifactsRequest = {
    workflow_run_backend_id: ids.workflowRunBackendId,
    workflow_job_run_backend_id: ids.workflowJobRunBackendId,
  }
  if (nameFilter !== undefined) {
    request.name_filter = nameFilter
  }
  return request
}

/**
 * Narrow a twirp response body to a plain record, loud on anything else.
 */
export function asArtifactResponseRecord(
  json: unknown,
  method: string,
): Record<string, unknown> {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw new Error(
      `The artifact service answered with a non-object body. Where: the ${method} twirp response. Saw: ${JSON.stringify(json)}; wanted a JSON object. Fix: re-run the job; if it persists, check GitHub Actions artifact service status.`,
    )
  }
  return json as Record<string, unknown>
}

/**
 * Read a string field from a twirp JSON response, accepting both the proto
 * snake_case name and the camelCase JSON name - proto3 JSON parsers accept
 * either, so the service may emit either.
 */
export function readArtifactStringField(
  record: Record<string, unknown>,
  protoName: string,
  jsonName: string,
): string | undefined {
  const value = record[jsonName] ?? record[protoName]
  return typeof value === 'string' ? value : undefined
}

export function readCreateArtifactResponse(
  json: unknown,
): CreateArtifactResponse {
  const record = asArtifactResponseRecord(json, 'CreateArtifact')
  return {
    ok: record['ok'] === true,
    signedUploadUrl: readArtifactStringField(
      record,
      'signed_upload_url',
      'signedUploadUrl',
    ),
  }
}

export function readFinalizeArtifactResponse(
  json: unknown,
): FinalizeArtifactResponse {
  const record = asArtifactResponseRecord(json, 'FinalizeArtifact')
  const raw = record['artifactId'] ?? record['artifact_id']
  let artifactId: number | undefined
  if (typeof raw === 'number') {
    artifactId = raw
  } else if (typeof raw === 'string' && raw !== '') {
    const parsed = Number.parseInt(raw, 10)
    artifactId = Number.isNaN(parsed) ? undefined : parsed
  }
  return { ok: record['ok'] === true, artifactId }
}

export function readGetSignedArtifactUrlResponse(
  json: unknown,
): GetSignedArtifactUrlResponse {
  const record = asArtifactResponseRecord(json, 'GetSignedArtifactURL')
  return {
    signedUrl: readArtifactStringField(record, 'signed_url', 'signedUrl'),
  }
}

export function readListArtifactsResponse(
  json: unknown,
): ListArtifactsResponse {
  const record = asArtifactResponseRecord(json, 'ListArtifacts')
  const rawArtifacts = record['artifacts']
  if (!Array.isArray(rawArtifacts)) {
    return { artifacts: [] }
  }
  const artifacts: ArtifactListEntry[] = []
  for (const entry of rawArtifacts) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      continue
    }
    const artifact = entry as Record<string, unknown>
    const name = artifact['name']
    if (typeof name !== 'string') {
      continue
    }
    artifacts.push({
      databaseId: readArtifactStringField(
        artifact,
        'database_id',
        'databaseId',
      ),
      name,
      size: readArtifactStringField(artifact, 'size', 'size'),
      workflowJobRunBackendId: readArtifactStringField(
        artifact,
        'workflow_job_run_backend_id',
        'workflowJobRunBackendId',
      ),
      workflowRunBackendId: readArtifactStringField(
        artifact,
        'workflow_run_backend_id',
        'workflowRunBackendId',
      ),
    })
  }
  return { artifacts }
}

/**
 * True when a thrown twirp/HTTP error must NOT be retried: any 4xx - the
 * client retries only 5xx server errors.
 */
export function isNonRetryableArtifactError(thrown: unknown): boolean {
  return thrown instanceof HttpResponseError && thrown.response.status < 500
}

// How much of an unrecognized error body to quote before truncating. Long
// enough for a twirp message, short enough to stay one log line.
export const ARTIFACT_ERROR_BODY_MAX_CHARS = 500

/**
 * The reason the artifact service gave, read off a failed response.
 *
 * A twirp error body is `{"code":"invalid_argument","msg":"..."}`, and the
 * `msg` is the only part that says WHY the call was rejected. Returns a
 * placeholder rather than throwing, because this runs while building an error
 * message and must never replace the original failure with its own.
 */
export function readTwirpErrorDetail(response: HttpResponse): string {
  let text: string
  try {
    text = response.text()
  } catch {
    return '<body unreadable>'
  }
  if (!text) {
    return '<empty body>'
  }
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>
    const code = typeof parsed['code'] === 'string' ? parsed['code'] : undefined
    const msg = typeof parsed['msg'] === 'string' ? parsed['msg'] : undefined
    const detail = [code, msg].filter(Boolean).join(': ')
    if (detail) {
      return detail
    }
  } catch {
    // Not JSON; fall through and quote the raw text.
  }
  return text.length > ARTIFACT_ERROR_BODY_MAX_CHARS
    ? `${text.slice(0, ARTIFACT_ERROR_BODY_MAX_CHARS)}…`
    : text
}

/**
 * What to do about a given artifact-service status. Each arm names the thing
 * the operator can actually check, since the service does not.
 */
export function artifactTwirpFixHint(status: number): string {
  if (status === 400) {
    return 'the request was malformed for this run: confirm ACTIONS_RUNTIME_TOKEN carries a scp claim whose run and job ids belong to THIS job (a token exposed from another job 400s here), and that the artifact name is unique within the run.'
  }
  if (status === 401 || status === 403) {
    return 'the token is missing or not accepted: expose-actions-runtime must run in the same job, and ACTIONS_RUNTIME_TOKEN expires with the job.'
  }
  if (status === 404) {
    return 'the service URL is wrong: check ACTIONS_RESULTS_URL is the runner-injected value.'
  }
  if (status === 409) {
    return 'an artifact with this name already exists in the run: upload each name once, or give this job a distinct name.'
  }
  return 're-run the job; if it persists, check GitHub Actions artifact service status.'
}

/**
 * The loud form of an artifact-service failure. socket-lib's HttpResponseError
 * carries only `HTTP <status>: <statusText>`, which names neither the method
 * nor the reason, so a 400 arrives unattributable. Non-HTTP throws pass through
 * unchanged - they already carry their own message.
 */
export function describeArtifactTwirpFailure(
  method: string,
  url: string,
  thrown: unknown,
): string | undefined {
  if (!(thrown instanceof HttpResponseError)) {
    return undefined
  }
  const { response } = thrown
  const { status } = response
  const statusText = response.statusText || 'no status message'
  return (
    `The artifact service rejected ${method}. ` +
    `Where: POST ${url}. ` +
    `Saw: HTTP ${status} ${statusText} - ${readTwirpErrorDetail(response)}; ` +
    `wanted HTTP 200 with a twirp response body. ` +
    `Fix: ${artifactTwirpFixHint(status)}`
  )
}

/**
 * POST one twirp method. Throws on non-2xx (5xx retried, 4xx immediate) with
 * the method, the URL, and the service's own reason in the message; resolves
 * with the parsed JSON body.
 */
export async function artifactTwirpPost(
  config: ArtifactServiceConfig,
  method: string,
  body: object,
): Promise<unknown> {
  const url = artifactTwirpUrl(config.baseUrl, method)
  try {
    return await artifactTwirpPostRaw(url, config.token, method, body)
  } catch (e) {
    const described = describeArtifactTwirpFailure(method, url, e)
    if (described === undefined) {
      throw e
    }
    throw new Error(described, { cause: e })
  }
}

/**
 * The bare POST, split out so the wrapper above owns error shaping and this
 * owns the wire call.
 */
export async function artifactTwirpPostRaw(
  url: string,
  token: string,
  method: string,
  body: object,
): Promise<unknown> {
  return await httpJson(url, {
    body: JSON.stringify(body),
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
    onRetry: (attempt: number, thrown: unknown, delay: number) => {
      if (isNonRetryableArtifactError(thrown)) {
        return false
      }
      logger.info(
        `Artifact-service ${method} attempt ${attempt} failed: ${errorMessage(thrown)}. Retrying in ${delay} ms.`,
      )
      return undefined
    },
    retries: ARTIFACT_TWIRP_RETRIES,
    retryDelay: ARTIFACT_TWIRP_RETRY_DELAY_MS,
    throwOnError: true,
  })
}
