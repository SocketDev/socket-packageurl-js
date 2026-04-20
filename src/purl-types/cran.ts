/**
 * @fileoverview CRAN (R packages) PURL validation.
 * https://github.com/package-url/purl-spec/blob/master/PURL-TYPES.rst#cran
 */

import { httpJson } from '@socketsecurity/lib/http-request'

import {
  ArrayPrototypeIncludes,
  StringPrototypeIncludes,
  encodeComponent,
} from '../primordials.js'
import {
  validateNoInjectionByType,
  validateRequiredByType,
} from '../validate.js'

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
 * Check if an R package exists on CRAN.
 *
 * Queries CRAN database to verify package existence and retrieve
 * the latest version. Note: CRAN provides a list of all packages
 * via their packages.rds file.
 *
 * @param name - Package name (e.g., 'ggplot2')
 * @param version - Optional version to validate (e.g., '3.4.4')
 * @param options - Optional configuration including cache
 * @returns Promise resolving to existence result with latest version
 *
 * @example
 * ```typescript
 * // Check if package exists
 * const result = await cranExists('ggplot2')
 * // -> { exists: true, latestVersion: '3.4.4' }
 *
 * // Validate specific version
 * const result = await cranExists('ggplot2', '3.4.4')
 * // -> { exists: true, latestVersion: '3.4.4' }
 *
 * // Non-existent package
 * const result = await cranExists('FakePackage')
 * // -> { exists: false, error: 'Package not found' }
 * ```
 */
export async function cranExists(
  name: string,
  version?: string,
  options?: ExistsOptions,
): Promise<ExistsResult> {
  const cacheKey = version ? `cran:${name}@${version}` : `cran:${name}`

  // Try cache first if provided
  if (options?.cache) {
    const cached = await options.cache.get<ExistsResult>(cacheKey)
    if (cached !== undefined) {
      return cached
    }
  }

  const fetchResult = async (): Promise<ExistsResult> => {
    try {
      // CRAN provides a JSON API via r-universe
      const url = `https://cran.r-universe.dev/api/packages/${encodeComponent(name)}`

      const data = await httpJson<{
        Version?: string
        versions?: string[]
      }>(url)

      const latestVersion = data.Version

      if (version) {
        const versions = data.versions || []
        if (!ArrayPrototypeIncludes(versions, version)) {
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

/**
 * Validate CRAN package URL.
 * CRAN packages require a version. Name must not contain injection characters.
 */
export function validate(purl: PurlObject, throws: boolean): boolean {
  if (
    !validateRequiredByType('cran', 'version', purl.version, {
      throws,
    })
  ) {
    return false
  }
  if (!validateNoInjectionByType('cran', 'name', purl.name, throws)) {
    return false
  }
  return true
}
