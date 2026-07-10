/**
 * @file Composer (PHP) PURL normalization.
 *   https://github.com/package-url/purl-spec/blob/main/PURL-TYPES.rst#composer.
 */

import { errorMessage } from '../error.mjs'
import { httpJson } from '@socketsecurity/lib/http-request'

import { ArrayPrototypeSome } from '@socketsecurity/lib/primordials/array'
import { encodeURIComponent as GlobalEncodeUriComponent } from '@socketsecurity/lib/primordials/globals'
import { StringPrototypeIncludes } from '@socketsecurity/lib/primordials/string'
import { lowerName, lowerNamespace } from '../strings.mjs'

import type { ExistsOptions, ExistsResult } from './npm.mjs'

export interface PurlObject {
  name: string
  namespace?: string | undefined
  qualifiers?: Record<string, string> | undefined
  subpath?: string | undefined
  type?: string | undefined
  version?: string | undefined
}

/**
 * Normalize Composer package URL. Lowercases both `namespace` and `name`.
 */
export function normalize(purl: PurlObject): PurlObject {
  lowerNamespace(purl)
  lowerName(purl)
  return purl
}

/**
 * Check if a Composer package exists on Packagist.
 *
 * Queries Packagist.org API to verify package existence and retrieve the latest
 * version. Composer packages have `vendor/package` format.
 *
 * @example
 *   ;```typescript
 *   // Check if package exists
 *   const result = await packagistExists('http-foundation', 'symfony')
 *   // -> { exists: true, latestVersion: 'v6.3.0' }
 *
 *   // Validate specific version
 *   const result = await packagistExists(
 *     'http-foundation',
 *     'symfony',
 *     'v6.3.0',
 *   )
 *   // -> { exists: true, latestVersion: 'v6.3.0' }
 *
 *   // Non-existent package
 *   const result = await packagistExists('fake-package', 'vendor')
 *   // -> { exists: false, error: 'Package not found' }
 *   ```
 *
 * @param name - Package name (e.g., `'http-foundation'`)
 * @param namespace - Vendor name (e.g., `'symfony'`)
 * @param version - Optional version to validate (e.g., `'v6.3.0'`)
 * @param options - Optional configuration including `cache`
 *
 * @returns `Promise` resolving to existence result with latest version
 */
export async function packagistExists(
  name: string,
  namespace?: string,
  version?: string,
  options?: ExistsOptions,
): Promise<ExistsResult> {
  const opts = { __proto__: null, ...options } as typeof options
  if (!namespace) {
    return { exists: false, error: 'Composer requires namespace (vendor)' }
  }

  const packageName = `${namespace}/${name}`
  const cacheKey = version
    ? `composer:${packageName}@${version}`
    : `composer:${packageName}`

  if (opts?.cache) {
    const cached = await opts.cache.get<ExistsResult>(cacheKey)
    if (cached !== undefined) {
      return cached
    }
  }

  const fetchResult = async (): Promise<ExistsResult> => {
    try {
      const url = `https://repo.packagist.org/p2/${GlobalEncodeUriComponent(packageName)}.json`

      const data = await httpJson<{
        packages?:
          | {
              [key: string]: Array<{
                version?: string | undefined
                version_normalized?: string | undefined
              }>
            }
          | undefined
      }>(url)

      const packageVersions = data.packages?.[packageName]
      if (!packageVersions || packageVersions.length === 0) {
        return { exists: false, error: 'Package not found' }
      }

      // Find the latest stable version (highest `version_normalized` without `dev` suffix)
      let latestVersion: string | undefined
      for (let i = 0, { length } = packageVersions; i < length; i += 1) {
        // Loop bound guarantees i < length, so packageVersions[i] is defined.
        const pkg = packageVersions[i]!
        const ver = pkg.version
        if (ver && !StringPrototypeIncludes(ver, 'dev-')) {
          latestVersion = ver
          break
        }
      }

      if (version) {
        const versionExists = ArrayPrototypeSome(
          packageVersions,
          (pkg: {
            version?: string | undefined
            version_normalized?: string | undefined
          }) => pkg.version === version,
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

      const result: ExistsResult = { exists: true }
      if (latestVersion !== undefined) {
        result.latestVersion = latestVersion
      }
      return result
    } catch (e) {
      /* v8 ignore start - httpJson typically throws Error; String(e) is defensive programming */
      const error = errorMessage(e)
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
  if (opts?.cache && result.exists) {
    await opts.cache.set(cacheKey, Object.freeze(result))
  }
  return result
}
