/**
 * @file Hackage (Haskell) PURL validation and registry existence check.
 *   https://github.com/package-url/purl-spec/blob/main/PURL-TYPES.rst#hackage.
 */

import { errorMessage } from '../error.mjs'
import { httpJson } from '@socketsecurity/lib/http-request'

import { ArrayPrototypeIncludes } from '@socketsecurity/lib/primordials/array'
import { encodeURIComponent as GlobalEncodeUriComponent } from '@socketsecurity/lib/primordials/globals'
import { StringPrototypeIncludes } from '@socketsecurity/lib/primordials/string'
import { validateEmptyByType, validateNoInjectionByType } from '../validate.mjs'

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
 * Check if a Haskell package exists on Hackage.
 *
 * Queries Hackage API to verify package existence and retrieve the latest
 * version.
 *
 * @example
 *   ;```typescript
 *   // Check if package exists
 *   const result = await hackageExists('aeson')
 *   // -> { exists: true, latestVersion: '2.2.0.0' }
 *
 *   // Validate specific version
 *   const result = await hackageExists('aeson', '2.2.0.0')
 *   // -> { exists: true, latestVersion: '2.2.0.0' }
 *
 *   // Non-existent package
 *   const result = await hackageExists('fake-package')
 *   // -> { exists: false, error: 'Package not found' }
 *   ```
 *
 * @param name - Package name (e.g., `'aeson'`)
 * @param version - Optional version to validate (e.g., `'2.2.0.0'`)
 * @param options - Optional configuration including `cache`
 *
 * @returns `Promise` resolving to existence result with latest version
 */
export async function hackageExists(
  name: string,
  version?: string | undefined,
  options?: ExistsOptions | undefined,
): Promise<ExistsResult> {
  const opts = { __proto__: null, ...options } as typeof options
  const cacheKey = version ? `hackage:${name}@${version}` : `hackage:${name}`

  // Try cache first if provided
  if (opts?.cache) {
    const cached = await opts.cache.get<ExistsResult>(cacheKey)
    if (cached !== undefined) {
      return cached
    }
  }

  const fetchResult = async (): Promise<ExistsResult> => {
    try {
      const url = `https://hackage.haskell.org/package/${GlobalEncodeUriComponent(name)}/preferred`

      const data = await httpJson<{
        'normal-version'?: string[] | undefined
      }>(url)

      const versions = data['normal-version'] || []
      if (versions.length === 0) {
        return { exists: false, error: 'No versions found' }
      }

      // Latest version is typically the last in the array
      // `versions` is non-empty here (the length === 0 early-return above),
      // so the last element is always defined.
      const latestVersion = versions[versions.length - 1]!

      if (version) {
        if (!ArrayPrototypeIncludes(versions, version)) {
          return {
            exists: false,
            error: `Version ${version} not found`,
            latestVersion,
          }
        }
      }

      return { exists: true, latestVersion }
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

/**
 * Validate Hackage package URL. Hackage packages must not have a `namespace`
 * (the spec prohibits it); `name` must not contain injection characters. The
 * name stays case-sensitive kebab-case per spec, so there is no normalize step.
 */
export function validate(
  purl: PurlObject,
  options?: { throws?: boolean | undefined } | undefined,
): boolean {
  const { throws = false } = options ?? {}
  if (
    !validateEmptyByType('hackage', 'namespace', purl.namespace, { throws })
  ) {
    return false
  }
  if (!validateNoInjectionByType('hackage', 'name', purl.name, { throws })) {
    return false
  }
  return true
}
