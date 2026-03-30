/**
 * @fileoverview RubyGems-specific PURL validation.
 * https://github.com/package-url/purl-spec/blob/master/types-doc/gem-definition.md
 */

import { httpJson } from '@socketsecurity/lib/http-request'

import { PurlError } from '../error.js'
import { ArrayPrototypeSome, StringPrototypeIncludes } from '../primordials.js'
import { containsInjectionCharacters } from '../strings.js'
import { validateEmptyByType } from '../validate.js'

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
 * Check if a Ruby gem exists in rubygems.org.
 *
 * Queries rubygems.org at https://rubygems.org/api/v1/versions to verify gem
 * existence and optionally validate a specific version. Returns the latest
 * version from the versions array.
 *
 * **Caching:** Responses can be cached using a TTL cache to reduce registry
 * requests. Pass `{ cache }` option with a cache instance from `createTtlCache()`.
 *
 * @param name - Gem name (e.g., 'rails', 'rake')
 * @param version - Optional version to validate (e.g., '7.0.0')
 * @param options - Optional configuration including cache
 * @returns Promise resolving to existence result with latest version
 *
 * @example
 * ```typescript
 * // Check if gem exists
 * const result = await gemExists('rails')
 * // -> { exists: true, latestVersion: '7.1.3' }
 *
 * // Validate specific version
 * const result = await gemExists('rake', '13.0.0')
 * // -> { exists: true, latestVersion: '13.1.0' }
 *
 * // With caching
 * import { createTtlCache } from '@socketsecurity/lib/cache-with-ttl'
 * const cache = createTtlCache({ ttl: 5 * 60 * 1000, prefix: 'gem' })
 * const result = await gemExists('rails', undefined, { cache })
 *
 * // Non-existent gem
 * const result = await gemExists('this-gem-does-not-exist')
 * // -> { exists: false, error: 'Gem not found' }
 * ```
 */
export async function gemExists(
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
      const url = `https://rubygems.org/api/v1/versions/${encodeURIComponent(name)}.json`

      const data = await httpJson<Array<{ number?: string }>>(url)

      if (!Array.isArray(data) || data.length === 0) {
        return {
          exists: false,
          error: 'No versions found',
        }
      }

      const latestVersion = data[0]?.['number']

      // If specific version requested, validate it exists
      if (version) {
        const versionExists = ArrayPrototypeSome(
          data,
          v => v.number === version,
        )
        if (!versionExists) {
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
      /* c8 ignore next - httpJson typically throws Error; String(e) is defensive programming */
      const error = e instanceof Error ? e.message : String(e)
      return {
        exists: false,
        error: StringPrototypeIncludes(error, '404') ? 'Gem not found' : error,
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

/**
 * Validate RubyGem package URL.
 * Gem packages must not have a namespace. Name must not contain injection characters.
 */
export function validate(purl: PurlObject, throws: boolean): boolean {
  if (
    !validateEmptyByType('gem', 'namespace', purl.namespace, {
      throws,
    })
  ) {
    return false
  }
  if (containsInjectionCharacters(purl.name)) {
    if (throws) {
      throw new PurlError('gem "name" component contains illegal characters')
    }
    return false
  }
  return true
}
