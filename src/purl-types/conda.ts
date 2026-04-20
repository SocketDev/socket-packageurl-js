/**
 * @fileoverview Conda-specific PURL normalization and validation.
 * https://github.com/package-url/purl-spec/blob/master/PURL-TYPES.rst#conda
 */

import { httpJson } from '@socketsecurity/lib/http-request'

import {
  ArrayPrototypeIncludes,
  StringPrototypeIncludes,
  encodeComponent,
} from '../primordials.js'
import { lowerName } from '../strings.js'
import { validateEmptyByType, validateNoInjectionByType } from '../validate.js'

import type { ExistsOptions, ExistsResult } from './npm.js'

interface PurlObject {
  name: string
  namespace?: string | undefined
  qualifiers?: Record<string, string> | undefined
  subpath?: string | undefined
  type?: string | undefined
  version?: string | undefined
}

/**
 * Normalize Conda package URL.
 * Lowercases name only.
 */
export function normalize(purl: PurlObject): PurlObject {
  lowerName(purl)
  return purl
}

/**
 * Validate Conda package URL.
 * Conda packages must not have a namespace. Name must not contain injection characters.
 */
export function validate(purl: PurlObject, throws: boolean): boolean {
  if (
    !validateEmptyByType('conda', 'namespace', purl.namespace, {
      throws,
    })
  ) {
    return false
  }
  if (!validateNoInjectionByType('conda', 'name', purl.name, throws)) {
    return false
  }
  return true
}

/**
 * Check if a Conda package exists in Anaconda.org.
 *
 * Queries Anaconda.org at https://api.anaconda.org/package to verify package
 * existence and optionally validate a specific version. Returns the latest
 * version from package metadata.
 *
 * **Note:** Defaults to conda-forge channel. Specify channel parameter for
 * other channels like 'defaults', 'anaconda', etc.
 *
 * **Caching:** Responses can be cached using a TTL cache to reduce registry
 * requests. Pass `{ cache }` option with a cache instance from `createTtlCache()`.
 *
 * @param name - Package name (e.g., 'numpy', 'pandas')
 * @param version - Optional version to validate (e.g., '1.24.3')
 * @param channel - Optional channel name (defaults to 'conda-forge')
 * @param options - Optional configuration including cache
 * @returns Promise resolving to existence result with latest version
 *
 * @example
 * ```typescript
 * // Check if package exists (defaults to conda-forge)
 * const result = await condaExists('numpy')
 * // -> { exists: true, latestVersion: '1.26.3' }
 *
 * // Check with custom channel
 * const result = await condaExists('numpy', undefined, 'defaults')
 * // -> { exists: true, latestVersion: '1.26.3' }
 *
 * // Validate specific version
 * const result = await condaExists('pandas', '2.1.4')
 * // -> { exists: true, latestVersion: '2.2.0' }
 *
 * // With caching
 * import { createTtlCache } from '@socketsecurity/lib/cache-with-ttl'
 * const cache = createTtlCache({ ttl: 5 * 60 * 1000, prefix: 'conda' })
 * const result = await condaExists('numpy', undefined, undefined, { cache })
 *
 * // Non-existent package
 * const result = await condaExists('this-package-does-not-exist')
 * // -> { exists: false, error: 'Package not found' }
 * ```
 */
export async function condaExists(
  name: string,
  version?: string,
  channel?: string,
  options?: ExistsOptions,
): Promise<ExistsResult> {
  // Use provided channel or default to conda-forge (most popular community channel)
  const channelName = channel || 'conda-forge'
  const cacheKey = version
    ? `conda:${channelName}/${name}@${version}`
    : `conda:${channelName}/${name}`

  // Try cache first if provided
  if (options?.cache) {
    const cached = await options.cache.get<ExistsResult>(cacheKey)
    if (cached !== undefined) {
      return cached
    }
  }

  const fetchResult = async (): Promise<ExistsResult> => {
    try {
      const encodedChannel = encodeComponent(channelName)
      const encodedName = encodeComponent(name)
      const url = `https://api.anaconda.org/package/${encodedChannel}/${encodedName}`

      const data = await httpJson<{
        latest_version?: string
        versions?: string[]
      }>(url)

      const latestVersion = data.latest_version

      // If specific version requested, validate it exists
      if (version) {
        if (!data.versions || !ArrayPrototypeIncludes(data.versions, version)) {
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
      /* v8 ignore start */
      const error = e instanceof Error ? e.message : String(e)
      /* v8 ignore stop */
      return {
        exists: false,
        error: StringPrototypeIncludes(error, '404')
          ? 'Package not found'
          : error,
      }
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
