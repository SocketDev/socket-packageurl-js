/*
 * @file Which Sigstore instance signs an attestation, and where its services
 *   live.
 *
 *   Two instances, and the split is a privacy boundary rather than a
 *   preference. A PUBLIC repo signs against public-good Sigstore and its
 *   signature is witnessed by the public Rekor transparency log, which is the
 *   point: anyone can later prove the artifact was signed when it says it was.
 *   A PRIVATE repo must NOT appear in that log — the log is public, so an entry
 *   would leak the repository name, the workflow path, and the fact of the
 *   build. It signs against GitHub's own Fulcio and gets a timestamp from a TSA
 *   instead, which provides the same "this signature predates now" property
 *   without publishing anything.
 *
 *   So `rekorURL` and `tsaServerURL` are mutually exclusive by design. Setting
 *   both, or defaulting to the public instance when visibility is unknown, would
 *   publish a private repo's build into a public log — irreversibly, since a
 *   transparency log cannot be edited.
 *
 *   Ported from actions/toolkit's packages/attest/src/endpoints.ts (reference
 *   pin upstream/actions-toolkit).
 */

/**
 * The public-good Sigstore instance, used for public repositories.
 */
export const FULCIO_PUBLIC_GOOD_URL = 'https://fulcio.sigstore.dev'

/**
 * The public transparency log, used for public repositories only.
 */
export const REKOR_PUBLIC_GOOD_URL = 'https://rekor.sigstore.dev'

/**
 * Which instance to sign against. `public-good` publishes to Rekor; `github`
 * keeps the signature off the public log.
 */
export type SigstoreInstance = 'github' | 'public-good'

export interface Endpoints {
  readonly fulcioURL: string
  readonly rekorURL?: string | undefined
  readonly tsaServerURL?: string | undefined
}

/**
 * The instance a repository's visibility implies.
 *
 * Anything that is not literally `public` resolves to `github`. That is the
 * safe direction and it is deliberate: an unknown or absent visibility must not
 * fall through to the public log, because publishing a private repo's build
 * there cannot be undone.
 */
export function instanceForVisibility(
  visibility: string | undefined,
): SigstoreInstance {
  return visibility === 'public' ? 'public-good' : 'github'
}

/**
 * GitHub's own signing endpoints for `serverUrl`.
 *
 * The public host maps to `githubapp.com` rather than `github.com` — the
 * services live on the app domain. An enterprise host keeps its own hostname,
 * so an enterprise attestation is signed by that enterprise's services rather
 * than reaching out to github.com.
 */
export function githubEndpoints(serverUrl: string): Endpoints {
  let host: string
  try {
    host = new URL(serverUrl).hostname
  } catch {
    // An unparseable server URL is a broken environment, not a reason to fall
    // back to the public instance and leak a private build.
    throw new Error(
      `Unusable server URL ${JSON.stringify(serverUrl)}; cannot resolve the signing endpoints.`,
    )
  }
  const domain = host === 'github.com' ? 'githubapp.com' : host
  return {
    fulcioURL: `https://fulcio.${domain}`,
    tsaServerURL: `https://timestamp.${domain}`,
  }
}

/**
 * The endpoints to sign with, from the repository's visibility and host.
 */
export function signingEndpoints(
  visibility: string | undefined,
  serverUrl: string,
): Endpoints {
  return instanceForVisibility(visibility) === 'public-good'
    ? { fulcioURL: FULCIO_PUBLIC_GOOD_URL, rekorURL: REKOR_PUBLIC_GOOD_URL }
    : githubEndpoints(serverUrl)
}
