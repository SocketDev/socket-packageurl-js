/**
 * @fileoverview CPAN registry existence check.
 * Queries MetaCPAN API to verify Perl module existence.
 */

import { httpGetJson } from '@socketsecurity/lib/http-request'

import type { ExistsResult, ExistsOptions } from './npm.js'

/**
 * Check if a Perl module exists on CPAN.
 *
 * Queries MetaCPAN API to verify module existence and retrieve
 * the latest version.
 *
 * @param name - Module name (e.g., 'Moose')
 * @param version - Optional version to validate (e.g., '2.2206')
 * @param options - Optional configuration including cache
 * @returns Promise resolving to existence result with latest version
 *
 * @example
 * ```typescript
 * // Check if module exists
 * const result = await cpanExists('Moose')
 * // -> { exists: true, latestVersion: '2.2206' }
 *
 * // Validate specific version
 * const result = await cpanExists('Moose', '2.2206')
 * // -> { exists: true, latestVersion: '2.2206' }
 *
 * // Non-existent module
 * const result = await cpanExists('FakeModule')
 * // -> { exists: false, error: 'Module not found' }
 * ```
 */
export async function cpanExists(
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
      const url = `https://fastapi.metacpan.org/v1/module/${encodeURIComponent(name)}`

      const data = await httpGetJson<{
        version?: string
      }>(url)

      const latestVersion = data.version

      if (version) {
        // Check specific version
        const versionUrl = `https://fastapi.metacpan.org/v1/module/${encodeURIComponent(name)}/${encodeURIComponent(version)}`
        try {
          await httpGetJson(versionUrl)
        } catch {
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
      /* c8 ignore next - httpGetJson always throws Error, String(e) is defensive but unreachable */
      const error = e instanceof Error ? e.message : String(e)
      return {
        exists: false,
        error: error.includes('404') ? 'Module not found' : error,
      }
    }
  }

  const result = await fetchResult()
  if (options?.cache) {
    await options.cache.set(cacheKey, result)
  }
  return result
}
