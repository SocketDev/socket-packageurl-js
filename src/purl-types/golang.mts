/**
 * @file Golang-specific PURL validation.
 *   https://github.com/package-url/purl-spec/blob/main/docs/types.md.
 *
 *   ## Case in Go Module Names
 *
 *   The canonical PURL PRESERVES the case of the golang `namespace` and `name`
 *   — Go module identity is case-sensitive (`github.com/User/Repo` and
 *   `github.com/user/repo` are distinct modules; the wrong case resolves to the
 *   wrong module or none). We deliberately do NOT register a golang normalizer.
 *   This matches the closest sibling, the upstream `packageurl-js`, which
 *   commented its golang lowercaser out for the same reason ("Ignore
 *   case-insensitive rule because go.mod are case-sensitive. Pending spec
 *   change: https://github.com/package-url/purl-spec/pull/196"), and matches
 *   `packageurl-python` and `packageurl-ruby`, which also preserve case.
 *   `packageurl-go` / `packageurl-java` / `packageurl-php` lowercase instead;
 *   the implementations split, and the purl-spec golang definition is itself
 *   contradictory (`case_sensitive: true` yet a note reading "must be
 *   lowercased"). The shared spec test suite has no uppercase golang
 *   name/namespace case, so nothing actually constrains this. See purl-spec
 *   issues #67 / #136 and PR #196 for the open debate. The Go module proxy
 *   separately case-encodes paths for case-insensitive filesystems — every
 *   uppercase letter becomes `!` + its lowercase form (`github.com/Azure` ->
 *   `github.com/!azure`). That is an official Go proxy protocol transport
 *   detail (`go help goproxy`, https://go.dev/ref/mod#goproxy-protocol;
 *   implemented in the Go toolchain's `golang.org/x/mod/module`, NOT an
 *   Artifactory invention), not part of the canonical PURL. See
 *   {@link encodeGolangProxyPath} / {@link decodeGolangProxyPath} for the full
 *   protocol provenance.
 */

import { httpJson } from '@socketsecurity/lib/http-request'

import { errorMessage, PurlError } from '../error.mjs'
import { ArrayPrototypeJoin } from '@socketsecurity/lib/primordials/array'
import { encodeURIComponent as GlobalEncodeUriComponent } from '@socketsecurity/lib/primordials/globals'
import {
  StringPrototypeCharCodeAt,
  StringPrototypeIncludes,
  StringPrototypeReplace,
  StringPrototypeSlice,
  StringPrototypeSplit,
  StringPrototypeToLowerCase,
  StringPrototypeToUpperCase,
} from '@socketsecurity/lib/primordials/string'
import { isSemverString } from '../strings.mjs'
import { validateNoInjectionByType } from '../validate.mjs'

import type { ExistsOptions, ExistsResult } from './npm.mjs'

/**
 * Decode a Go module proxy escaped path or version back to its real case.
 *
 * The proxy protocol escapes uppercase letters as `!` then lowercase; a literal
 * `!` is reserved as the escape character and may not otherwise appear, so the
 * `!`-then-lowercase pairing is unambiguous:
 *
 * - `github.com/!data!dog/datadog-go` -> `github.com/DataDog/datadog-go`
 * - `v1.0.0-!r!c1` -> `v1.0.0-RC1`
 *
 * The "no literal `!`" guarantee is by design in the Go toolchain
 * (`golang.org/x/mod/module`, `unescapeString`): "Import paths have never
 * allowed exclamation marks, so there is no need to define how to escape a
 * literal `!`." Inverse of {@link encodeGolangProxyPath} (which carries the
 * full protocol provenance).
 *
 * @see https://go.dev/ref/mod#goproxy-protocol
 * @see https://github.com/golang/mod/blob/v0.36.0/module/module.go#L763 (unescapeString)
 */
export function decodeGolangProxyPath(path: string): string {
  return StringPrototypeReplace(path, /!([a-z])/g, (_match, letter: unknown) =>
    StringPrototypeToUpperCase(String(letter)),
  )
}

export interface PurlObject {
  name: string
  namespace?: string | undefined
  qualifiers?: Record<string, string> | undefined
  subpath?: string | undefined
  type?: string | undefined
  version?: string | undefined
}

/**
 * Encode a Go module path or version for the Go module proxy protocol.
 *
 * The proxy escapes every uppercase letter as `!` + its lowercase form so that
 * case-insensitive filesystems and URLs cannot collide case-distinct modules:
 *
 * - `github.com/DataDog/datadog-go` -> `github.com/!data!dog/datadog-go`
 * - `v1.0.0-RC1` -> `v1.0.0-!r!c1`
 *
 * This is a transport detail of `proxy.golang.org`, not part of the canonical
 * PURL string. Inverse of {@link decodeGolangProxyPath}.
 *
 * ## Provenance — this is official Go, not Artifactory-specific
 *
 * Defined in the official Go module proxy protocol (Go Modules Reference,
 * "Module proxies", and `go help goproxy`), which states that to avoid
 * ambiguity when serving from case-insensitive file systems, the $module and
 * $version elements are case-encoded by replacing every uppercase letter with
 * an exclamation mark followed by the corresponding lower-case letter.
 *
 * Implemented in the Go toolchain itself — `golang.org/x/mod/module`, function
 * `escapeString` (called by `EscapePath` / `EscapeVersion`). Rationale,
 * verbatim: "we cannot rely on the file system to keep rsc.io/QUOTE and
 * rsc.io/quote separate. Windows and macOS don't… The safe escaped form is to
 * replace every uppercase letter with an exclamation mark followed by the
 * letter's lowercase equivalent."
 *
 * All conformant proxies (proxy.golang.org, Athens, Nexus, Artifactory) must
 * implement it; the Go client emits these `!`-encoded URLs regardless of which
 * proxy it talks to. Artifactory merely conforms (and historically had a bug
 * failing to: a Go maintainer on golang/go#34084 told an Artifactory user "This
 * is correct as documented in `go help goproxy`… Please file a bug against
 * Artifactory" -> JFrog ticket RTFACT-20227).
 *
 * Ecosystem note: among the purl libraries, only `packageurl-python` ships this
 * escape (`contrib/purl2url.py` `escape_golang_path`, the same purl->URL role
 * as our url-converter), and it cites the same Go proxy protocol. packageurl-go
 * / java / php / ruby / upstream-js do NOT implement it — purl->proxy-URL is an
 * optional convenience, not core purl parsing, so most libraries skip it.
 *
 * @see https://go.dev/ref/mod#goproxy-protocol
 * @see https://github.com/golang/mod/blob/v0.36.0/module/module.go#L707 (escapeString)
 * @see https://github.com/golang/go/issues/34084
 */
export function encodeGolangProxyPath(path: string): string {
  return StringPrototypeReplace(
    path,
    /[A-Z]/g,
    letter => `!${StringPrototypeToLowerCase(letter)}`,
  )
}

/**
 * Check if a Go module exists in the Go module proxy.
 *
 * Queries `proxy.golang.org` to verify module existence and retrieve the latest
 * version. Go module names are typically full import paths like
 * `'github.com/user/repo'`.
 *
 * @example
 *   ;```typescript
 *   // Check if module exists
 *   const result = await golangExists('github.com/gorilla/mux')
 *   // -> { exists: true, latestVersion: 'v1.8.0' }
 *
 *   // With namespace (constructs full path)
 *   const result = await golangExists('mux', 'github.com/gorilla')
 *   // -> { exists: true, latestVersion: 'v1.8.0' }
 *
 *   // Validate specific version
 *   const result = await golangExists(
 *     'github.com/gorilla/mux',
 *     undefined,
 *     'v1.8.0',
 *   )
 *   // -> { exists: true, latestVersion: 'v1.8.0' }
 *
 *   // Non-existent module
 *   const result = await golangExists('github.com/fake/module')
 *   // -> { exists: false, error: 'Module not found' }
 *   ```
 *
 * @param name - Full module path (e.g., `'github.com/gorilla/mux'`)
 * @param namespace - Optional namespace (combined with `name` if provided)
 * @param version - Optional version to validate (e.g., `'v1.8.0'`)
 * @param options - Optional configuration including `cache`
 *
 * @returns `Promise` resolving to existence result with latest version
 */
export async function golangExists(
  name: string,
  namespace?: string,
  version?: string,
  options?: ExistsOptions,
): Promise<ExistsResult> {
  const opts = { __proto__: null, ...options } as typeof options
  const modulePath = namespace ? `${namespace}/${name}` : name
  const cacheKey = version
    ? `golang:${modulePath}@${version}`
    : `golang:${modulePath}`

  if (opts?.cache) {
    const cached = await opts.cache.get<ExistsResult>(cacheKey)
    if (cached !== undefined) {
      return cached
    }
  }

  const fetchResult = async (): Promise<ExistsResult> => {
    try {
      // Encode the module path for the URL
      // Go proxy uses case-encoded paths where uppercase letters are `!lowercase`
      const parts = StringPrototypeSplit(modulePath, '/')
      for (let i = 0; i < parts.length; i++) {
        parts[i] = GlobalEncodeUriComponent(encodeGolangProxyPath(parts[i]!))
      }
      const encodedPath = ArrayPrototypeJoin(parts, '/')

      const url = `https://proxy.golang.org/${encodedPath}/@latest`

      const data = await httpJson<{
        Version?: string | undefined
        Time?: string | undefined
      }>(url)

      const latestVersion = data.Version

      if (version) {
        const versionUrl = `https://proxy.golang.org/${encodedPath}/@v/${GlobalEncodeUriComponent(version)}.info`
        try {
          await httpJson(versionUrl)
        } catch {
          const result: ExistsResult = {
            exists: false,
            error: `Version ${version} not found`,
          }
          if (latestVersion !== undefined) {
            result.latestVersion = latestVersion
          }
          return result
        }
      }

      const result: ExistsResult = { exists: true }
      if (latestVersion !== undefined) {
        result.latestVersion = latestVersion
      }
      return result
    } catch (e) {
      /* v8 ignore start - httpJson typically throws Error; String(e) is defensive programming */
      const error = errorMessage(e)
      return {
        exists: false,
        error:
          StringPrototypeIncludes(error, '404') ||
          StringPrototypeIncludes(error, '410')
            ? 'Module not found'
            : error,
      }
      /* v8 ignore stop */
    }
  }

  const result = await fetchResult()
  // Only cache successful results to avoid negative cache poisoning
  // from transient failures (network errors, 5xx responses)
  if (opts?.cache && result.exists) {
    await opts.cache.set(cacheKey, Object.freeze(result))
  }
  return result
}

/**
 * Validate Golang package URL. `name` and `namespace` must not contain
 * injection characters. If `version` starts with `"v"`, it must be followed by
 * a valid semver version.
 */
export function validate(
  purl: PurlObject,
  options?: { throws?: boolean | undefined } | undefined,
): boolean {
  const { throws = false } = options ?? {}
  if (
    !validateNoInjectionByType('golang', 'namespace', purl.namespace, {
      throws,
    })
  ) {
    return false
  }
  if (!validateNoInjectionByType('golang', 'name', purl.name, { throws })) {
    return false
  }
  // Still being lenient here since the standard changes aren't official
  // Pending spec change: https://github.com/package-url/purl-spec/pull/196
  const { version } = purl
  const length = typeof version === 'string' ? version.length : 0
  // If the version starts with a `"v"` then ensure its a valid semver version
  // This, by semver semantics, also supports pseudo-version number
  // https://go.dev/doc/modules/version-numbers#pseudo-version-number
  if (
    length &&
    StringPrototypeCharCodeAt(version!, 0) === 118 /*'v'*/ &&
    !isSemverString(StringPrototypeSlice(version!, 1))
  ) {
    if (throws) {
      throw new PurlError(
        'golang "version" component starting with a "v" must be followed by a valid semver version',
      )
    }
    return false
  }
  return true
}
