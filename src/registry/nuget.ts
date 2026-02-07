/**
 * @fileoverview NuGet registry existence check.
 * Queries NuGet.org API to verify package existence.
 */

import { httpGetJson } from '@socketsecurity/lib/http-request'

import type { ExistsResult, ExistsOptions } from './npm.js'

/**
 * Check if a NuGet package exists in NuGet.org.
 *
 * Queries the NuGet V3 API to verify package existence and retrieve
 * the latest version.
 *
 * @param name - Package name (e.g., 'Newtonsoft.Json')
 * @param version - Optional version to validate (e.g., '13.0.3')
 * @param options - Optional configuration including cache
 * @returns Promise resolving to existence result with latest version
 *
 * @example
 * ```typescript
 * // Check if package exists
 * const result = await nugetExists('Newtonsoft.Json')
 * // -> { exists: true, latestVersion: '13.0.3' }
 *
 * // Validate specific version
 * const result = await nugetExists('Newtonsoft.Json', '13.0.3')
 * // -> { exists: true, latestVersion: '13.0.3' }
 *
 * // Non-existent package
 * const result = await nugetExists('fake-package-xyz')
 * // -> { exists: false, error: 'Package not found' }
 * ```
 */
export async function nugetExists(
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
      const lowerName = name.toLowerCase()
      const url = `https://api.nuget.org/v3/registration5-semver1/${encodeURIComponent(lowerName)}/index.json`

      const data = await httpGetJson<{
        items?: Array<{
          items?: Array<{
            catalogEntry?: {
              version?: string
            }
          }>
          upper?: string
        }>
      }>(url)

      if (!data.items || data.items.length === 0) {
        return { exists: false, error: 'Package not found' }
      }

      // Get all versions from all pages
      const versions: string[] = []
      for (const page of data.items) {
        if (page.items) {
          for (const item of page.items) {
            const ver = item.catalogEntry?.['version']
            if (ver) {
              versions.push(ver)
            }
          }
        }
      }

      if (versions.length === 0) {
        return { exists: false, error: 'No versions found' }
      }

      // Latest version is typically the last one
      const latestVersion = versions[versions.length - 1]

      if (version) {
        if (!versions.includes(version)) {
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
