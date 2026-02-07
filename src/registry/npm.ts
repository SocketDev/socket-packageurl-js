/**
 * @fileoverview npm registry existence check.
 * Queries npm registry to verify package existence and retrieve latest version.
 */

import { httpGetJson } from '@socketsecurity/lib/http-request'

import type { TtlCache } from '@socketsecurity/lib/cache-with-ttl'

/**
 * Result of package existence check.
 */
export type ExistsResult = {
  exists: boolean
  latestVersion?: string
  error?: string
}

/**
 * Options for registry existence checks.
 */
export type ExistsOptions = {
  /**
   * Optional TTL cache instance for caching registry responses.
   * If provided, responses will be cached with configured TTL.
   *
   * @example
   * ```typescript
   * import { createTtlCache } from '@socketsecurity/lib/cache-with-ttl'
   * import { npmExists } from '@socketregistry/packageurl-js'
   *
   * const cache = createTtlCache({ ttl: 5 * 60 * 1000, prefix: 'npm-registry' })
   * const result = await npmExists('lodash', undefined, undefined, { cache })
   * ```
   */
  cache?: TtlCache
}

/**
 * Check if an npm package exists in the registry.
 *
 * Queries the npm registry at https://registry.npmjs.org to verify package
 * existence and optionally validate a specific version. Returns the latest
 * version from dist-tags.
 *
 * **Caching:** Responses can be cached using a TTL cache to reduce registry
 * requests. Pass `{ cache }` option with a cache instance from `createTtlCache()`.
 *
 * @param name - Package name (e.g., 'lodash', 'core' for scoped packages)
 * @param namespace - Optional namespace/scope (e.g., '@babel')
 * @param version - Optional version to validate (e.g., '4.17.21')
 * @param options - Optional configuration including cache
 * @returns Promise resolving to existence result with latest version
 *
 * @example
 * ```typescript
 * // Check if package exists
 * const result = await npmExists('lodash')
 * // -> { exists: true, latestVersion: '4.17.21' }
 *
 * // Check scoped package
 * const result = await npmExists('core', '@babel')
 * // -> { exists: true, latestVersion: '7.23.0' }
 *
 * // Validate specific version
 * const result = await npmExists('lodash', undefined, '4.17.21')
 * // -> { exists: true, latestVersion: '4.17.21' }
 *
 * // With caching
 * import { createTtlCache } from '@socketsecurity/lib/cache-with-ttl'
 * const cache = createTtlCache({ ttl: 5 * 60 * 1000, prefix: 'npm' })
 * const result = await npmExists('lodash', undefined, undefined, { cache })
 *
 * // Non-existent package
 * const result = await npmExists('this-package-does-not-exist')
 * // -> { exists: false, error: 'Package not found' }
 * ```
 */
export async function npmExists(
  name: string,
  namespace?: string,
  version?: string,
  options?: ExistsOptions,
): Promise<ExistsResult> {
  // Build cache key
  const packageName = namespace ? `${namespace}/${name}` : name
  const cacheKey = version ? `${packageName}@${version}` : packageName

  // Try cache first if provided
  if (options?.cache) {
    const cached = await options.cache.get<ExistsResult>(cacheKey)
    if (cached !== undefined) {
      return cached
    }
  }

  const fetchResult = async (): Promise<ExistsResult> => {
    try {
      const encodedName = encodeURIComponent(packageName)
      const url = `https://registry.npmjs.org/${encodedName}`

      const data = await httpGetJson<{
        'dist-tags'?: { latest?: string }
        versions?: Record<string, unknown>
      }>(url)

      const latestVersion = data['dist-tags']?.['latest']

      // If specific version requested, validate it exists
      if (version && data.versions) {
        if (!(version in data.versions)) {
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
      // httpGetJson throws on non-2xx status codes
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
