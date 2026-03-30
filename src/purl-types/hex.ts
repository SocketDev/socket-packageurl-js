/**
 * @fileoverview Hex (Erlang/Elixir) PURL normalization.
 * https://github.com/package-url/purl-spec/blob/master/PURL-TYPES.rst#hex
 */

import { httpJson } from '@socketsecurity/lib/http-request'

import { PurlError } from '../error.js'
import { ArrayPrototypeSome, StringPrototypeIncludes } from '../primordials.js'
import {
  containsInjectionCharacters,
  lowerName,
  lowerNamespace,
} from '../strings.js'

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

      const data = await httpJson<{
        latest_version?: string
        releases?: Array<{
          version?: string
        }>
      }>(url)

      const latestVersion = data.latest_version

      if (version) {
        const releases = data.releases || []
        const versionExists = ArrayPrototypeSome(
          releases,
          r => r.version === version,
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
  if (options?.cache) {
    await options.cache.set(cacheKey, result)
  }
  return result
}

/**
 * Normalize Hex package URL.
 * Lowercases both namespace and name.
 */
export function normalize(purl: PurlObject): PurlObject {
  lowerNamespace(purl)
  lowerName(purl)
  return purl
}

/**
 * Validate Hex package URL.
 * Name and namespace must not contain injection characters.
 */
export function validate(purl: PurlObject, throws: boolean): boolean {
  if (
    typeof purl.namespace === 'string' &&
    containsInjectionCharacters(purl.namespace)
  ) {
    if (throws) {
      throw new PurlError(
        'hex "namespace" component contains illegal characters',
      )
    }
    return false
  }
  if (containsInjectionCharacters(purl.name)) {
    if (throws) {
      throw new PurlError('hex "name" component contains illegal characters')
    }
    return false
  }
  return true
}
