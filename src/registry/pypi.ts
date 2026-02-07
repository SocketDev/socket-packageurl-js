/**
 * @fileoverview PyPI registry existence check.
 * Queries PyPI to verify package existence and retrieve latest version.
 */

import { httpGetJson } from '@socketsecurity/lib/http-request'

import type { ExistsResult, ExistsOptions } from './npm.js'

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
  const cacheKey = version ? `${name}@${version}` : name

  // Try cache first if provided
  if (options?.cache) {
    const cached = await options.cache.get<ExistsResult>(cacheKey)
    if (cached !== undefined) {
      return cached
    }
  }

  const fetchResult = async (): Promise<ExistsResult> => {
    try {
      const url = `https://pypi.org/pypi/${encodeURIComponent(name)}/json`

      const data = await httpGetJson<{
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
      /* c8 ignore next - httpGetJson always throws Error, String(e) is defensive but unreachable */
      const error = e instanceof Error ? e.message : String(e)
      return {
        exists: false,
        error: error.includes('404') ? 'Package not found' : error,
      }
    }
  }

  const result = await fetchResult()

  // Cache result if cache provided
  if (options?.cache) {
    await options.cache.set(cacheKey, result)
  }

  return result
}
