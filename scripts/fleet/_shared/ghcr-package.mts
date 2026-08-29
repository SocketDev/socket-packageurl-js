/**
 * @file One owner for the GitHub Packages path a container package sits at.
 *   These are the GitHub Packages REST API endpoints under
 *   `/orgs/{org}/packages/container/{name}` — NOT the OCI registry API that
 *   `ghcr.io/v2/...` serves. The two speak different paths and different auth,
 *   so a pull URL from the OCI side is never interchangeable with one of these.
 *   The name segment needs percent-encoding because a fleet package name is
 *   NESTED — `socket-wheelhouse/fleet-pack` carries a `/` that would otherwise
 *   split into two path segments and 404. `encodeURIComponent` is the correct
 *   primitive: it encodes EVERY slash. A `String.replace('/', '%2F')` with a
 *   string pattern replaces only the FIRST match, so a name with two slashes
 *   encoded wrong and the API call 404'd — the bug this module exists to
 *   retire. Long-term home: socket-lib's `github/packages` surface, once
 *   socket-lib 7.0.0 ships. Until then this local module is the single source
 *   of truth, and every caller imports these helpers rather than spelling the
 *   path again.
 */

// How many versions a GHCR versions read asks for per page. 100 is the
// endpoint's maximum, so a `--paginate` walk makes the fewest calls.
export const GHCR_VERSIONS_PER_PAGE = 100

/**
 * The percent-encoded `{name}` segment of a GitHub Packages container path,
 * e.g. `socket-wheelhouse/fleet-pack` → `socket-wheelhouse%2Ffleet-pack`.
 * Every slash is encoded, so a deeply nested name stays one path segment.
 */
export function ghcrContainerPackagePath(name: string): string {
  return encodeURIComponent(name)
}

/**
 * The GitHub Packages REST path listing a container package's versions, e.g.
 * `SocketDev` + `socket-wheelhouse/fleet-pack` →
 * `/orgs/SocketDev/packages/container/socket-wheelhouse%2Ffleet-pack/versions?per_page=100`.
 * The endpoint returns versions newest first.
 */
export function ghcrContainerVersionsPath(
  owner: string,
  name: string,
  perPage?: number | undefined,
): string {
  const encoded = ghcrContainerPackagePath(name)
  const size = perPage ?? GHCR_VERSIONS_PER_PAGE
  return `/orgs/${owner}/packages/container/${encoded}/versions?per_page=${size}`
}

/**
 * The web URL of a container package's settings page — where a human performs
 * the one-time visibility flip GitHub exposes no REST endpoint for.
 */
export function ghcrContainerSettingsUrl(owner: string, name: string): string {
  const encoded = ghcrContainerPackagePath(name)
  return `https://github.com/orgs/${owner}/packages/container/${encoded}/settings`
}
