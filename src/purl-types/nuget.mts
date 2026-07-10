/**
 * @file NuGet-specific PURL validation.
 *   https://github.com/package-url/purl-spec/blob/main/types-doc/nuget-definition.md.
 */

import { errorMessage } from '../error.mjs'
import { httpJson } from '@socketsecurity/lib/http-request'

import {
  ArrayPrototypeIncludes,
  ArrayPrototypePush,
} from '@socketsecurity/lib/primordials/array'
import { encodeURIComponent as GlobalEncodeUriComponent } from '@socketsecurity/lib/primordials/globals'
import {
  StringPrototypeIncludes,
  StringPrototypeToLowerCase,
} from '@socketsecurity/lib/primordials/string'
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
 * Check if a NuGet package exists in NuGet.org.
 *
 * Queries the NuGet V3 API to verify package existence and retrieve the latest
 * version.
 *
 * @example
 *   ;```typescript
 *   // Check if package exists
 *   const result = await nugetExists('Newtonsoft.Json')
 *   // -> { exists: true, latestVersion: '13.0.3' }
 *
 *   // Validate specific version
 *   const result = await nugetExists('Newtonsoft.Json', '13.0.3')
 *   // -> { exists: true, latestVersion: '13.0.3' }
 *
 *   // Non-existent package
 *   const result = await nugetExists('fake-package-xyz')
 *   // -> { exists: false, error: 'Package not found' }
 *   ```
 *
 * @param name - Package name (e.g., `'Newtonsoft.Json'`)
 * @param version - Optional version to validate (e.g., `'13.0.3'`)
 * @param options - Optional configuration including `cache`
 *
 * @returns `Promise` resolving to existence result with latest version
 */
export async function nugetExists(
  name: string,
  version?: string,
  options?: ExistsOptions,
): Promise<ExistsResult> {
  const opts = { __proto__: null, ...options } as typeof options
  const cacheKey = version ? `nuget:${name}@${version}` : `nuget:${name}`

  if (opts?.cache) {
    const cached = await opts.cache.get<ExistsResult>(cacheKey)
    if (cached !== undefined) {
      return cached
    }
  }

  const fetchResult = async (): Promise<ExistsResult> => {
    try {
      const lowerName = StringPrototypeToLowerCase(name)
      const url = `https://api.nuget.org/v3/registration5-semver1/${GlobalEncodeUriComponent(lowerName)}/index.json`

      const data = await httpJson<{
        items?:
          | Array<{
              items?:
                | Array<{
                    catalogEntry?:
                      | {
                          version?: string | undefined
                        }
                      | undefined
                  }>
                | undefined
              upper?: string | undefined
            }>
          | undefined
      }>(url)

      if (!data.items || data.items.length === 0) {
        return { exists: false, error: 'Package not found' }
      }

      // Get all versions from all pages
      const versions: string[] = []
      const pages = data.items
      for (let i = 0, { length } = pages; i < length; i += 1) {
        // Loop bound guarantees i < length, so pages[i] is defined.
        const page = pages[i]!
        if (page.items) {
          const items = page.items
          for (
            let j = 0, { length: itemLength } = items;
            j < itemLength;
            j += 1
          ) {
            // Loop bound guarantees j < itemLength, so items[j] is defined.
            const item = items[j]!
            const ver = item.catalogEntry?.['version']
            if (ver) {
              ArrayPrototypePush(versions, ver)
            }
          }
        }
      }

      if (versions.length === 0) {
        return { exists: false, error: 'No versions found' }
      }

      // Latest version is typically the last one. `versions` is non-empty
      // here (the length === 0 early-return above) and only truthy strings
      // are pushed, so the last element is always defined.
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
 * Validate NuGet package URL. NuGet packages must not have a `namespace`.
 * `name` must not contain injection characters.
 */
export function validate(
  purl: PurlObject,
  options?: { throws?: boolean | undefined } | undefined,
): boolean {
  const { throws = false } = options ?? {}
  if (
    !validateEmptyByType('nuget', 'namespace', purl.namespace, {
      throws,
    })
  ) {
    return false
  }
  if (!validateNoInjectionByType('nuget', 'name', purl.name, { throws })) {
    return false
  }
  return true
}
