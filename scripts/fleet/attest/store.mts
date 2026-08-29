/*
 * @file Persisting a signed attestation to the repository's attestation store.
 *
 *   One POST to `/repos/{owner}/{repo}/attestations` with the Sigstore bundle.
 *   That endpoint is what `gh attestation verify` later reads, so an attestation
 *   that signs correctly but is never stored is invisible: the artifact looks
 *   unattested, and the fleet's own consumer refuses to stage it.
 *
 *   The HTTP call is injected. Every branch here is then reachable without a
 *   network, and the tests cannot accidentally reach the real API — a stored
 *   attestation is a durable, externally visible side effect, and a test suite
 *   has no business creating one.
 */

/**
 * The REST path an attestation is written to. Matched by the API, so it is not
 * ours to reshape.
 */
export function attestationsPath(owner: string, repo: string): string {
  return `/repos/${owner}/${repo}/attestations`
}

/**
 * An `owner/repo` slug split, or undefined when it is not one.
 *
 * Strict about the shape because the parts become a URL path: a slug carrying a
 * slash too many would POST to some other endpoint entirely, and one carrying
 * too few would 404 in a way that reads like a permissions problem.
 */
export function parseRepoSlug(
  slug: string,
): { owner: string; repo: string } | undefined {
  const parts = slug.split('/')
  if (parts.length !== 2) {
    return undefined
  }
  const [owner, repo] = parts
  return owner && repo ? { owner, repo } : undefined
}

/**
 * The request body. The API takes the bundle under a `bundle` key rather than
 * bare, so this is a wire shape rather than a wrapper of convenience.
 */
export function attestationBody(bundle: unknown): { bundle: unknown } {
  return { bundle }
}

/**
 * The attestation id out of a response body, or undefined when it carries none.
 *
 * Absent is reported rather than defaulted: the id is what a caller echoes as
 * the run's output, and inventing one would claim a stored attestation that may
 * not exist.
 */
export function parseAttestationId(payload: unknown): string | undefined {
  const id = (payload as { id?: unknown | undefined } | undefined)?.id
  if (typeof id === 'string' && id) {
    return id
  }
  return typeof id === 'number' ? String(id) : undefined
}

/**
 * How the caller performs the POST. Injected so this module needs no HTTP
 * client of its own and the tests need no network.
 */
export type PostAttestation = (
  path: string,
  body: { bundle: unknown },
) => Promise<unknown>

/**
 * Store `bundle` and return the attestation id.
 *
 * A response with no id THROWS rather than returning empty. The store is the
 * step that makes the attestation findable, so "stored, id unknown" is not a
 * state worth reporting as success — it reads as done while a verifier finds
 * nothing.
 */
export async function writeAttestation(config: {
  readonly bundle: unknown
  readonly post: PostAttestation
  readonly slug: string
}): Promise<string> {
  const opts = { __proto__: null, ...config } as typeof config
  const parsed = parseRepoSlug(opts.slug)
  if (!parsed) {
    throw new Error(
      `Unusable repository ${JSON.stringify(opts.slug)}. Wanted: owner/repo.`,
    )
  }
  const path = attestationsPath(parsed.owner, parsed.repo)
  const response = await opts.post(path, attestationBody(opts.bundle))
  const id = parseAttestationId(response)
  if (!id) {
    throw new Error(
      `${path} accepted the attestation but returned no id; treating that as a failed store rather than a silent success.`,
    )
  }
  return id
}
