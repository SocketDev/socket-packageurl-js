/**
 * @fileoverview PyPI-specific PURL normalization.
 * https://github.com/package-url/purl-spec/blob/master/PURL-TYPES.rst#pypi
 */

import { httpJson } from '@socketsecurity/lib/http-request'

import { StringPrototypeIncludes, encodeComponent } from '../primordials.js'
import {
  lowerName,
  lowerNamespace,
  lowerVersion,
  replaceUnderscoresWithDashes,
} from '../strings.js'
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
 * Normalize PyPI package URL.
 * Lowercases namespace, name, and version, replaces underscores with dashes in name.
 * Spec: namespace, name, and version are all case-insensitive.
 */
export function normalize(purl: PurlObject): PurlObject {
  lowerNamespace(purl)
  lowerName(purl)
  lowerVersion(purl)
  purl.name = replaceUnderscoresWithDashes(purl.name)
  return purl
}

/**
 * Validate PyPI package URL.
 * Name must not contain injection characters.
 */
export function validate(purl: PurlObject, throws: boolean): boolean {
  if (!validateNoInjectionByType('pypi', 'name', purl.name, throws)) {
    return false
  }
  return true
}

/**
 * Check if a PyPI package exists in the registry.
 *
 * Queries PyPI at https://pypi.org/pypi to verify package existence and
 * optionally validate a specific version. Returns the latest version from
 * package metadata.
 *
 * **Caching:** Responses can be cached using a TTL cache to reduce registry
 * requests. Pass `{ cache }` option with a cache instance from `createTtlCache()`.
 *
 * @param name - Package name (e.g., 'requests', 'django')
 * @param version - Optional version to validate (e.g., '2.28.1')
 * @param options - Optional configuration including cache
 * @returns Promise resolving to existence result with latest version
 *
 * @example
 * ```typescript
 * // Check if package exists
 * const result = await pypiExists('requests')
 * // -> { exists: true, latestVersion: '2.31.0' }
 *
 * // Validate specific version
 * const result = await pypiExists('django', '4.2.0')
 * // -> { exists: true, latestVersion: '5.0.0' }
 *
 * // With caching
 * import { createTtlCache } from '@socketsecurity/lib/cache-with-ttl'
 * const cache = createTtlCache({ ttl: 5 * 60 * 1000, prefix: 'pypi' })
 * const result = await pypiExists('requests', undefined, { cache })
 *
 * // Non-existent package
 * const result = await pypiExists('this-package-does-not-exist')
 * // -> { exists: false, error: 'Package not found' }
 * ```
 */
export async function pypiExists(
  name: string,
  version?: string,
  options?: ExistsOptions,
): Promise<ExistsResult> {
  const cacheKey = version ? `pypi:${name}@${version}` : `pypi:${name}`

  // Try cache first if provided
  if (options?.cache) {
    const cached = await options.cache.get<ExistsResult>(cacheKey)
    if (cached !== undefined) {
      return cached
    }
  }

  const fetchResult = async (): Promise<ExistsResult> => {
    try {
      const url = `https://pypi.org/pypi/${encodeComponent(name)}/json`

      const data = await httpJson<{
        info?: { version?: string }
        releases?: Record<string, unknown[]>
      }>(url)

      const latestVersion = data.info?.['version']

      // If specific version requested, validate it exists
      if (version && data.releases) {
        if (!(version in data.releases)) {
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

      const result: ExistsResult = {
        exists: true,
      }
      if (latestVersion !== undefined) {
        result.latestVersion = latestVersion
      }
      return result
    } catch (e) {
      /* v8 ignore start - httpJson typically throws Error; String(e) is defensive programming */
      const error = e instanceof Error ? e.message : String(e)
      return {
        exists: false,
        error: StringPrototypeIncludes(error, '404')
          ? 'Package not found'
          : error,
      }
      /* v8 ignore stop */
    }
  }

  const result = await fetchResult()

  // Only cache successful results to avoid negative cache poisoning
  // from transient failures (network errors, 5xx responses)
  if (options?.cache && result.exists) {
    await options.cache.set(cacheKey, Object.freeze(result))
  }

  return result
}
