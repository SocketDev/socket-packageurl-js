/**
 * @fileoverview Pub registry existence check.
 * Queries pub.dev API to verify Dart/Flutter package existence.
 */

import { httpGetJson } from '@socketsecurity/lib/http-request'

import type { ExistsResult, ExistsOptions } from './npm.js'

/**
 * Check if a Dart/Flutter package exists on pub.dev.
 *
 * Queries pub.dev API to verify package existence and retrieve
 * the latest version.
 *
 * @param name - Package name (e.g., 'flutter_bloc')
 * @param version - Optional version to validate (e.g., '8.1.3')
 * @param options - Optional configuration including cache
 * @returns Promise resolving to existence result with latest version
 *
 * @example
 * ```typescript
 * // Check if package exists
 * const result = await pubExists('flutter_bloc')
 * // -> { exists: true, latestVersion: '8.1.3' }
 *
 * // Validate specific version
 * const result = await pubExists('flutter_bloc', '8.1.3')
 * // -> { exists: true, latestVersion: '8.1.3' }
 *
 * // Non-existent package
 * const result = await pubExists('fake_package')
 * // -> { exists: false, error: 'Package not found' }
 * ```
 */
export async function pubExists(
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
      const url = `https://pub.dev/api/packages/${encodeURIComponent(name)}`

      const data = await httpGetJson<{
        latest?: {
          version?: string
        }
        versions?: Array<{
          version?: string
        }>
      }>(url)

      const latestVersion = data.latest?.['version']

      if (version) {
        const versions = data.versions || []
        const versionExists = versions.some(v => v.version === version)
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
        error: error.includes('404') ? 'Package not found' : error,
      }
    }
  }

  const result = await fetchResult()
  if (options?.cache) {
    await options.cache.set(cacheKey, result)
  }
  return result
}
