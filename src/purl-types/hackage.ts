/**
 * @fileoverview Hackage (Haskell) registry existence check.
 * https://github.com/package-url/purl-spec/blob/master/PURL-TYPES.rst#hackage
 */

import { httpJson } from '@socketsecurity/lib/http-request'

import {
  ArrayPrototypeIncludes,
  StringPrototypeIncludes,
  encodeComponent,
} from '../primordials.js'

import type { ExistsResult, ExistsOptions } from './npm.js'

/**
 * Check if a Haskell package exists on Hackage.
 *
 * Queries Hackage API to verify package existence and retrieve
 * the latest version.
 *
 * @param name - Package name (e.g., 'aeson')
 * @param version - Optional version to validate (e.g., '2.2.0.0')
 * @param options - Optional configuration including cache
 * @returns Promise resolving to existence result with latest version
 *
 * @example
 * ```typescript
 * // Check if package exists
 * const result = await hackageExists('aeson')
 * // -> { exists: true, latestVersion: '2.2.0.0' }
 *
 * // Validate specific version
 * const result = await hackageExists('aeson', '2.2.0.0')
 * // -> { exists: true, latestVersion: '2.2.0.0' }
 *
 * // Non-existent package
 * const result = await hackageExists('fake-package')
 * // -> { exists: false, error: 'Package not found' }
 * ```
 */
export async function hackageExists(
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
      const url = `https://hackage.haskell.org/package/${encodeComponent(name)}/preferred`

      const data = await httpJson<{
        'normal-version'?: string[]
      }>(url)

      const versions = data['normal-version'] || []
      if (versions.length === 0) {
        return { exists: false, error: 'No versions found' }
      }

      // Latest version is typically the last in the array
      const latestVersion = versions[versions.length - 1]

      if (version) {
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
      /* c8 ignore next - httpJson typically throws Error; String(e) is defensive programming */
      const error = e instanceof Error ? e.message : String(e)
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
    await options.cache.set(cacheKey, result)
  }

  return result
}
