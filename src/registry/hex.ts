/**
 * @fileoverview Hex registry existence check.
 * Queries hex.pm API to verify Elixir/Erlang package existence.
 */

import { httpGetJson } from '@socketsecurity/lib/http-request'

import type { ExistsResult, ExistsOptions } from './npm.js'

/**
 * Check if an Elixir/Erlang package exists on hex.pm.
 *
 * Queries hex.pm API to verify package existence and retrieve
 * the latest version.
 *
 * @param name - Package name (e.g., 'phoenix')
 * @param version - Optional version to validate (e.g., '1.7.10')
 * @param options - Optional configuration including cache
 * @returns Promise resolving to existence result with latest version
 *
 * @example
 * ```typescript
 * // Check if package exists
 * const result = await hexExists('phoenix')
 * // -> { exists: true, latestVersion: '1.7.10' }
 *
 * // Validate specific version
 * const result = await hexExists('phoenix', '1.7.10')
 * // -> { exists: true, latestVersion: '1.7.10' }
 *
 * // Non-existent package
 * const result = await hexExists('fake_package')
 * // -> { exists: false, error: 'Package not found' }
 * ```
 */
export async function hexExists(
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
      const url = `https://hex.pm/api/packages/${encodeURIComponent(name)}`

      const data = await httpGetJson<{
        latest_version?: string
        releases?: Array<{
          version?: string
        }>
      }>(url)

      const latestVersion = data.latest_version

      if (version) {
        const releases = data.releases || []
        const versionExists = releases.some(r => r.version === version)
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
