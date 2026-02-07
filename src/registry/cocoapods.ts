/**
 * @fileoverview CocoaPods registry existence check.
 * Queries CocoaPods trunk API to verify pod existence.
 */

import { httpGetJson } from '@socketsecurity/lib/http-request'

import type { ExistsResult, ExistsOptions } from './npm.js'

/**
 * Check if a CocoaPod exists in the CocoaPods trunk.
 *
 * Queries trunk.cocoapods.org API to verify pod existence and retrieve
 * the latest version.
 *
 * @param name - Pod name (e.g., 'Alamofire')
 * @param version - Optional version to validate (e.g., '5.8.1')
 * @param options - Optional configuration including cache
 * @returns Promise resolving to existence result with latest version
 *
 * @example
 * ```typescript
 * // Check if pod exists
 * const result = await cocoapodsExists('Alamofire')
 * // -> { exists: true, latestVersion: '5.8.1' }
 *
 * // Validate specific version
 * const result = await cocoapodsExists('Alamofire', '5.8.1')
 * // -> { exists: true, latestVersion: '5.8.1' }
 *
 * // Non-existent pod
 * const result = await cocoapodsExists('FakePod')
 * // -> { exists: false, error: 'Pod not found' }
 * ```
 */
export async function cocoapodsExists(
  name: string,
  version?: string,
  options?: ExistsOptions,
): Promise<ExistsResult> {
  const cacheKey = version ? `${name}@${version}` : name

  if (options?.cache) {
    const cached = await options.cache.get<ExistsResult>(cacheKey)
    if (cached !== undefined) {
      return cached
    }
  }

  const fetchResult = async (): Promise<ExistsResult> => {
    try {
      const url = `https://trunk.cocoapods.org/api/v1/pods/${encodeURIComponent(name)}`

      const data = await httpGetJson<{
        versions?: Array<{ name?: string }>
      }>(url)

      const versions = data.versions
      if (!versions || versions.length === 0) {
        return { exists: false, error: 'No versions found' }
      }

      // Latest version is first in the array
      const latestVersion = versions[0]?.['name']

      if (version) {
        const versionExists = versions.some(v => v.name === version)
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

      const result: ExistsResult = { exists: true }
      if (latestVersion !== undefined) {
        result.latestVersion = latestVersion
      }
      return result
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      return {
        exists: false,
        error: error.includes('404') ? 'Pod not found' : error,
      }
    }
  }

  const result = await fetchResult()
  if (options?.cache) {
    await options.cache.set(cacheKey, result)
  }
  return result
}
