/**
 * @fileoverview CocoaPods (iOS/macOS) PURL validation.
 * https://github.com/package-url/purl-spec/blob/master/types-doc/cocoapods-definition.md
 */

import { httpGetJson } from '@socketsecurity/lib/http-request'

import { PurlError } from '../error.js'

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

  // Try cache first if provided
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
      /* c8 ignore next - httpGetJson always throws Error, String(e) is defensive but unreachable */
      const error = e instanceof Error ? e.message : String(e)
      return {
        exists: false,
        error: error.includes('404') ? 'Pod not found' : error,
      }
    }
  }

  const result = await fetchResult()

  // Cache result if cache provided
  if (options?.cache) {
    await options.cache.set(cacheKey, result)
  }

  return result
}

/**
 * Validate CocoaPods package URL.
 * Name cannot contain whitespace, plus (+) character, or begin with a period (.).
 */
export function validate(purl: PurlObject, throws: boolean): boolean {
  const { name } = purl
  // Name cannot contain whitespace
  if (/\s/.test(name)) {
    if (throws) {
      throw new PurlError(
        'cocoapods "name" component cannot contain whitespace',
      )
    }
    return false
  }
  // Name cannot contain a plus (+) character
  if (name.includes('+')) {
    if (throws) {
      throw new PurlError(
        'cocoapods "name" component cannot contain a plus (+) character',
      )
    }
    return false
  }
  // Name cannot begin with a period (.)
  if (name.charCodeAt(0) === 46 /*'.'*/) {
    if (throws) {
      throw new PurlError(
        'cocoapods "name" component cannot begin with a period',
      )
    }
    return false
  }
  return true
}
