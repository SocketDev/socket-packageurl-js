/**
 * @fileoverview Golang-specific PURL validation.
 * https://github.com/package-url/purl-spec/blob/master/PURL-TYPES.rst#golang
 *
 * ## Case Sensitivity in Go Module Names
 *
 * Go module names are **case-sensitive** and should NOT be normalized to lowercase.
 * This is critical because:
 *
 * 1. **Module Identity**: Go treats module paths as case-sensitive identifiers.
 *    `github.com/User/Repo` and `github.com/user/repo` are different modules.
 *
 * 2. **Import Path Matching**: The import path must exactly match the module path
 *    declared in go.mod, including case.
 *
 * 3. **Proxy Encoding**: While the Go proxy uses case-encoding for URLs (uppercase
 *    letters become !lowercase, e.g., `User` → `!user`), this is an internal
 *    encoding detail. The original case must be preserved in PURLs.
 *
 * 4. **Filesystem Implications**: On case-insensitive filesystems (macOS, Windows),
 *    different-cased modules could collide, but Go's tooling handles this correctly
 *    when the original case is preserved.
 *
 * **Examples:**
 * - `pkg:golang/github.com/Masterminds/semver@v3.2.1` - Correct (preserves case)
 * - `pkg:golang/github.com/masterminds/semver@v3.2.1` - Wrong (loses case)
 *
 * See: https://go.dev/ref/mod#module-path
 */

import { httpJson } from '@socketsecurity/lib/http-request'

import { PurlError } from '../error.js'
import {
  ArrayPrototypeJoin,
  encodeComponent,
  StringPrototypeCharCodeAt,
  StringPrototypeIncludes,
  StringPrototypeReplace,
  StringPrototypeSlice,
  StringPrototypeSplit,
  StringPrototypeToLowerCase,
} from '../primordials.js'
import { isSemverString } from '../strings.js'
import { validateNoInjectionByType } from '../validate.js'

import type { ExistsResult, ExistsOptions } from './npm.js'

interface PurlObject {
  name: string
  namespace?: string | undefined
  qualifiers?: Record<string, string> | undefined
  subpath?: string | undefined
  type?: string | undefined
  version?: string | undefined
}

/**
 * Check if a Go module exists in the Go module proxy.
 *
 * Queries proxy.golang.org to verify module existence and retrieve
 * the latest version. Go module names are typically full import paths
 * like 'github.com/user/repo'.
 *
 * @param name - Full module path (e.g., 'github.com/gorilla/mux')
 * @param namespace - Optional namespace (combined with name if provided)
 * @param version - Optional version to validate (e.g., 'v1.8.0')
 * @param options - Optional configuration including cache
 * @returns Promise resolving to existence result with latest version
 *
 * @example
 * ```typescript
 * // Check if module exists
 * const result = await golangExists('github.com/gorilla/mux')
 * // -> { exists: true, latestVersion: 'v1.8.0' }
 *
 * // With namespace (constructs full path)
 * const result = await golangExists('mux', 'github.com/gorilla')
 * // -> { exists: true, latestVersion: 'v1.8.0' }
 *
 * // Validate specific version
 * const result = await golangExists('github.com/gorilla/mux', undefined, 'v1.8.0')
 * // -> { exists: true, latestVersion: 'v1.8.0' }
 *
 * // Non-existent module
 * const result = await golangExists('github.com/fake/module')
 * // -> { exists: false, error: 'Module not found' }
 * ```
 */
export async function golangExists(
  name: string,
  namespace?: string,
  version?: string,
  options?: ExistsOptions,
): Promise<ExistsResult> {
  const modulePath = namespace ? `${namespace}/${name}` : name
  const cacheKey = version ? `${modulePath}@${version}` : modulePath

  if (options?.cache) {
    const cached = await options.cache.get<ExistsResult>(cacheKey)
    if (cached !== undefined) {
      return cached
    }
  }

  const fetchResult = async (): Promise<ExistsResult> => {
    try {
      // Encode the module path for the URL
      // Go proxy uses case-encoded paths where uppercase letters are !lowercase
      const parts = StringPrototypeSplit(modulePath, '/' as any)
      for (let i = 0; i < parts.length; i++) {
        parts[i] = encodeComponent(
          StringPrototypeReplace(
            parts[i]!,
            /[A-Z]/g,
            letter => `!${StringPrototypeToLowerCase(letter)}`,
          ),
        )
      }
      const encodedPath = ArrayPrototypeJoin(parts, '/')

      const url = `https://proxy.golang.org/${encodedPath}/@latest`

      const data = await httpJson<{
        Version?: string
        Time?: string
      }>(url)

      const latestVersion = data.Version

      if (version) {
        const versionUrl = `https://proxy.golang.org/${encodedPath}/@v/${encodeComponent(version)}.info`
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
      /* c8 ignore next - httpJson typically throws Error; String(e) is defensive programming */
      const error = e instanceof Error ? e.message : String(e)
      return {
        exists: false,
        error:
          StringPrototypeIncludes(error, '404') ||
          StringPrototypeIncludes(error, '410')
            ? 'Module not found'
            : error,
      }
    }
  }

  const result = await fetchResult()
  // Only cache successful results to avoid negative cache poisoning
  // from transient failures (network errors, 5xx responses)
  if (options?.cache && result.exists) {
    await options.cache.set(cacheKey, result)
  }
  return result
}

/**
 * Validate Golang package URL.
 * Name and namespace must not contain injection characters.
 * If version starts with "v", it must be followed by a valid semver version.
 */
export function validate(purl: PurlObject, throws: boolean): boolean {
  if (
    !validateNoInjectionByType('golang', 'namespace', purl.namespace, throws)
  ) {
    return false
  }
  if (!validateNoInjectionByType('golang', 'name', purl.name, throws)) {
    return false
  }
  // Still being lenient here since the standard changes aren't official
  // Pending spec change: https://github.com/package-url/purl-spec/pull/196
  const { version } = purl
  const length = typeof version === 'string' ? version.length : 0
  // If the version starts with a "v" then ensure its a valid semver version
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
