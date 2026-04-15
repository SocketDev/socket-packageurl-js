/**
 * @fileoverview NuGet-specific PURL validation.
 * https://github.com/package-url/purl-spec/blob/master/types-doc/nuget-definition.md
 */

import { httpJson } from '@socketsecurity/lib/http-request'

import {
  ArrayPrototypeIncludes,
  ArrayPrototypePush,
  StringPrototypeIncludes,
  StringPrototypeToLowerCase,
  encodeComponent,
} from '../primordials.js'
import { validateEmptyByType, validateNoInjectionByType } from '../validate.js'

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
      const lowerName = StringPrototypeToLowerCase(name)
      const url = `https://api.nuget.org/v3/registration5-semver1/${encodeComponent(lowerName)}/index.json`

      const data = await httpJson<{
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
              ArrayPrototypePush(versions, ver)
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
    await options.cache.set(cacheKey, result)
  }
  return result
}

/**
 * Validate NuGet package URL.
 * NuGet packages must not have a namespace. Name must not contain injection characters.
 */
export function validate(purl: PurlObject, throws: boolean): boolean {
  if (
    !validateEmptyByType('nuget', 'namespace', purl.namespace, {
      throws,
    })
  ) {
    return false
  }
  if (!validateNoInjectionByType('nuget', 'name', purl.name, throws)) {
    return false
  }
  return true
}
