/**
 * @fileoverview Cargo-specific PURL validation.
 * https://github.com/package-url/purl-spec/blob/master/types-doc/cargo-definition.md
 */

import { httpJson } from '@socketsecurity/lib/http-request'

import {
  ArrayPrototypeSome,
  StringPrototypeIncludes,
  encodeComponent,
} from '../primordials.js'
import { validateEmptyByType, validateNoInjectionByType } from '../validate.js'

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
 * Check if a Cargo crate exists in crates.io.
 *
 * Queries crates.io at https://crates.io/api/v1/crates to verify crate
 * existence and optionally validate a specific version. Returns the max_version
 * from crate metadata.
 *
 * **Note:** crates.io requires a User-Agent header for API requests.
 *
 * **Caching:** Responses can be cached using a TTL cache to reduce registry
 * requests. Pass `{ cache }` option with a cache instance from `createTtlCache()`.
 *
 * @param name - Crate name (e.g., 'serde', 'tokio')
 * @param version - Optional version to validate (e.g., '1.0.152')
 * @param options - Optional configuration including cache
 * @returns Promise resolving to existence result with latest version
 *
 * @example
 * ```typescript
 * // Check if crate exists
 * const result = await cargoExists('serde')
 * // -> { exists: true, latestVersion: '1.0.197' }
 *
 * // Validate specific version
 * const result = await cargoExists('tokio', '1.35.0')
 * // -> { exists: true, latestVersion: '1.36.0' }
 *
 * // With caching
 * import { createTtlCache } from '@socketsecurity/lib/cache-with-ttl'
 * const cache = createTtlCache({ ttl: 5 * 60 * 1000, prefix: 'cargo' })
 * const result = await cargoExists('serde', undefined, { cache })
 *
 * // Non-existent crate
 * const result = await cargoExists('this-crate-does-not-exist')
 * // -> { exists: false, error: 'Crate not found' }
 * ```
 */
export async function cargoExists(
  name: string,
  version?: string,
  options?: ExistsOptions,
): Promise<ExistsResult> {
  const cacheKey = version ? `cargo:${name}@${version}` : `cargo:${name}`

  // Try cache first if provided
  if (options?.cache) {
    const cached = await options.cache.get<ExistsResult>(cacheKey)
    if (cached !== undefined) {
      return cached
    }
  }

  const fetchResult = async (): Promise<ExistsResult> => {
    try {
      const url = `https://crates.io/api/v1/crates/${encodeComponent(name)}`

      const data = await httpJson<{
        crate?: { max_version?: string }
        versions?: Array<{ num?: string }>
      }>(url, {
        headers: {
          'User-Agent': '@socketregistry/packageurl-js',
        },
      })

      const latestVersion =
        data.crate?.['max_version'] || data.versions?.[0]?.['num']

      // If specific version requested, validate it exists
      if (version && data.versions) {
        const versionExists = ArrayPrototypeSome(
          data.versions,
          v => v.num === version,
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
      /* v8 ignore start */
      const error = e instanceof Error ? e.message : String(e)
      /* v8 ignore stop */
      return {
        exists: false,
        error: StringPrototypeIncludes(error, '404')
          ? 'Crate not found'
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

/**
 * Validate Cargo package URL.
 * Cargo packages must not have a namespace. Name must not contain injection characters.
 */
export function validate(purl: PurlObject, throws: boolean): boolean {
  if (
    !validateEmptyByType('cargo', 'namespace', purl.namespace, {
      throws,
    })
  ) {
    return false
  }
  if (!validateNoInjectionByType('cargo', 'name', purl.name, throws)) {
    return false
  }
  return true
}
