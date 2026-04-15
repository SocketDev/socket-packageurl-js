/**
 * @fileoverview Maven-specific PURL validation.
 * https://github.com/package-url/purl-spec/blob/master/types-doc/maven-definition.md
 */

import { httpJson } from '@socketsecurity/lib/http-request'

import { StringPrototypeIncludes, encodeComponent } from '../primordials.js'
import {
  validateNoInjectionByType,
  validateRequiredByType,
} from '../validate.js'

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
 * Check if a Maven package exists in Maven Central.
 *
 * Queries search.maven.org API to verify package existence and retrieve
 * the latest version. Maven packages are identified by group ID (namespace)
 * and artifact ID (name).
 *
 * @param name - Artifact ID (e.g., 'commons-lang3')
 * @param namespace - Group ID (e.g., 'org.apache.commons')
 * @param version - Optional version to validate (e.g., '3.12.0')
 * @param options - Optional configuration including cache
 * @returns Promise resolving to existence result with latest version
 *
 * @example
 * ```typescript
 * // Check if package exists
 * const result = await mavenExists('commons-lang3', 'org.apache.commons')
 * // -> { exists: true, latestVersion: '3.12.0' }
 *
 * // Validate specific version
 * const result = await mavenExists('commons-lang3', 'org.apache.commons', '3.12.0')
 * // -> { exists: true, latestVersion: '3.12.0' }
 *
 * // Non-existent package
 * const result = await mavenExists('fake-artifact', 'com.example')
 * // -> { exists: false, error: 'Package not found' }
 * ```
 */
export async function mavenExists(
  name: string,
  namespace?: string,
  version?: string,
  options?: ExistsOptions,
): Promise<ExistsResult> {
  if (!namespace) {
    return { exists: false, error: 'Maven requires namespace (group ID)' }
  }

  const packageId = `${namespace}:${name}`
  const cacheKey = version ? `${packageId}@${version}` : packageId

  if (options?.cache) {
    const cached = await options.cache.get<ExistsResult>(cacheKey)
    if (cached !== undefined) {
      return cached
    }
  }

  const fetchResult = async (): Promise<ExistsResult> => {
    try {
      const g = encodeComponent(namespace)
      const a = encodeComponent(name)
      const url = `https://search.maven.org/solrsearch/select?q=g:${g}+AND+a:${a}&rows=1&wt=json`

      const data = await httpJson<{
        response?: {
          numFound?: number
          docs?: Array<{ latestVersion?: string; v?: string }>
        }
      }>(url)

      const numFound = data.response?.['numFound'] || 0
      if (numFound === 0) {
        return { exists: false, error: 'Package not found' }
      }

      const doc = data.response?.['docs']?.[0]
      const latestVersion = doc?.['latestVersion'] || doc?.['v']

      if (version) {
        const versionUrl = `https://search.maven.org/solrsearch/select?q=g:${g}+AND+a:${a}+AND+v:${encodeComponent(version)}&rows=1&wt=json`
        const versionData = await httpJson<{
          response?: { numFound?: number }
        }>(versionUrl)

        const versionFound = versionData.response?.['numFound'] || 0
        if (versionFound === 0) {
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
 * Validate Maven package URL.
 * Maven packages require a namespace (groupId). Name and namespace must not
 * contain injection characters.
 */
export function validate(purl: PurlObject, throws: boolean): boolean {
  if (
    !validateRequiredByType('maven', 'namespace', purl.namespace, {
      throws,
    })
  ) {
    return false
  }
  if (
    !validateNoInjectionByType('maven', 'namespace', purl.namespace, throws)
  ) {
    return false
  }
  if (!validateNoInjectionByType('maven', 'name', purl.name, throws)) {
    return false
  }
  return true
}
