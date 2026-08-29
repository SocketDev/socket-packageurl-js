/*
 * @file The OIDC token claims a build-provenance attestation is derived from.
 *
 *   The provenance predicate is built from CLAIMS, never from the `GITHUB_*`
 *   environment. That is the security property, not a style choice: any earlier
 *   step in the job can export `GITHUB_SHA` or `GITHUB_REPOSITORY` to whatever
 *   it likes, while the token is signed by the OIDC provider and a step cannot
 *   forge one. An attestation assembled from env would faithfully describe a
 *   build that never happened.
 *
 *   EVERY required claim is checked, and a missing one throws naming the field.
 *   The alternative is worse than a crash: an absent claim reaching the
 *   predicate as `undefined` yields a structurally valid attestation that
 *   asserts the wrong provenance, and `gh attestation verify` has no way to know
 *   it was supposed to say something else.
 */

import { Buffer } from 'node:buffer'

/**
 * The claims a GitHub Actions OIDC token carries that the SLSA predicate reads.
 * All strings: the token encodes numeric ids and run counters as strings, and
 * they are passed through unchanged so the emitted predicate matches what the
 * upstream implementation produces for the same token.
 */
export interface OidcClaims {
  readonly event_name: string
  readonly job_workflow_ref: string
  readonly ref: string
  readonly repository: string
  readonly repository_id: string
  readonly repository_owner_id: string
  readonly run_attempt: string
  readonly run_id: string
  readonly runner_environment: string
  readonly sha: string
  readonly workflow_ref: string
}

/**
 * The claim names {@link readClaims} requires, in the order it reports them.
 */
export const REQUIRED_CLAIMS: readonly string[] = [
  'event_name',
  'job_workflow_ref',
  'ref',
  'repository',
  'repository_id',
  'repository_owner_id',
  'run_attempt',
  'run_id',
  'runner_environment',
  'sha',
  'workflow_ref',
]

/**
 * The payload of a JWT, or undefined when `jwt` is not one.
 *
 * Signature verification is deliberately NOT done here. The token came from the
 * runner's own token endpoint over TLS, and it is Fulcio that validates the
 * signature when it issues the certificate — a local check would be theatre,
 * and getting it subtly wrong would be worse than not doing it. This only
 * decodes.
 */
export function decodeJwtClaims(
  jwt: string,
): Record<string, unknown> | undefined {
  const parts = jwt.split('.')
  if (parts.length !== 3) {
    return undefined
  }
  const payload = parts[1]
  if (!payload) {
    return undefined
  }
  let json: string
  try {
    json = Buffer.from(payload, 'base64url').toString('utf8')
  } catch {
    return undefined
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return undefined
  }
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : undefined
}

/**
 * The required claims, or a throw naming every field that is missing or not a
 * string.
 *
 * Reports ALL of them at once rather than the first: a token shaped wrongly is
 * usually missing a set — a job without `id-token: write` permissions, or a
 * non-Actions issuer — and one-at-a-time reporting turns that into a queue of
 * re-runs.
 */
export function readClaims(
  raw: Record<string, unknown> | undefined,
): OidcClaims {
  const bag = raw ?? {}
  const missing: string[] = []
  for (let i = 0, { length } = REQUIRED_CLAIMS; i < length; i += 1) {
    const field = REQUIRED_CLAIMS[i]!
    const value = bag[field]
    if (typeof value !== 'string' || value === '') {
      missing.push(field)
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `The OIDC token is missing required claim(s): ${missing.join(', ')}. ` +
        'Wanted: a GitHub Actions token minted for a job with `permissions: ' +
        'id-token: write`. An attestation is not built from a partial token - ' +
        'the absent claims would describe a build that did not happen.',
    )
  }
  return bag as unknown as OidcClaims
}
