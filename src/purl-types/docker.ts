/**
 * @fileoverview Docker-specific PURL normalization and validation.
 * https://github.com/package-url/purl-spec/blob/master/PURL-TYPES.rst#docker
 */

import { httpJson } from '@socketsecurity/lib/http-request'

import { StringPrototypeIncludes, encodeComponent } from '../primordials.js'
import { lowerName } from '../strings.js'
import { validateNoInjectionByType } from '../validate.js'

import type { ExistsOptions, ExistsResult } from './npm.js'

interface PurlObject {
  name: string
  namespace?: string | undefined
  qualifiers?: Record<string, string> | undefined
  subpath?: string | undefined
  type?: string | undefined
  version?: string | undefined
}

/**
 * Normalize Docker package URL.
 * Lowercases name only (namespace is case-sensitive for registry hosts).
 */
export function normalize(purl: PurlObject): PurlObject {
  lowerName(purl)
  return purl
}

/**
 * Validate Docker package URL.
 * Name and namespace must not contain injection characters.
 */
export function validate(purl: PurlObject, throws: boolean): boolean {
  if (
    !validateNoInjectionByType('docker', 'namespace', purl.namespace, throws)
  ) {
    return false
  }
  if (!validateNoInjectionByType('docker', 'name', purl.name, throws)) {
    return false
  }
  return true
}

/**
 * Check if a Docker image exists in Docker Hub.
 *
 * Queries Docker Hub API at https://hub.docker.com/v2/repositories to verify
 * image existence and optionally validate a specific tag. Returns the latest
 * tag if no specific tag is requested.
 *
 * **Note:** Docker Hub has rate limits for unauthenticated requests.
 *
 * **Caching:** Responses can be cached using a TTL cache to reduce registry
 * requests. Pass `{ cache }` option with a cache instance from `createTtlCache()`.
 *
 * @param name - Image name (e.g., 'nginx', 'redis')
 * @param namespace - Optional namespace/repository (e.g., 'library' for official images)
 * @param version - Optional tag to validate (e.g., 'latest', '1.25.3')
 * @param options - Optional configuration including cache
 * @returns Promise resolving to existence result with latest tag
 *
 * @example
 * ```typescript
 * // Check if official image exists
 * const result = await dockerExists('nginx', 'library')
 * // -> { exists: true, latestVersion: 'latest' }
 *
 * // Check user image
 * const result = await dockerExists('myapp', 'myuser')
 * // -> { exists: true, latestVersion: 'v1.0.0' }
 *
 * // Validate specific tag
 * const result = await dockerExists('nginx', 'library', '1.25.3')
 * // -> { exists: true, latestVersion: 'latest' }
 *
 * // With caching
 * import { createTtlCache } from '@socketsecurity/lib/cache-with-ttl'
 * const cache = createTtlCache({ ttl: 5 * 60 * 1000, prefix: 'docker' })
 * const result = await dockerExists('nginx', 'library', undefined, { cache })
 *
 * // Non-existent image
 * const result = await dockerExists('this-image-does-not-exist', 'library')
 * // -> { exists: false, error: 'Image not found' }
 * ```
 */
export async function dockerExists(
  name: string,
  namespace?: string,
  version?: string,
  options?: ExistsOptions,
): Promise<ExistsResult> {
  // Default namespace to 'library' for official images if not specified
  const repo = namespace ? `${namespace}/${name}` : name
  const cacheKey = version ? `${repo}:${version}` : repo

  // Try cache first if provided
  if (options?.cache) {
    const cached = await options.cache.get<ExistsResult>(cacheKey)
    if (cached !== undefined) {
      return cached
    }
  }

  const fetchResult = async (): Promise<ExistsResult> => {
    try {
      // Encode each path segment separately to preserve the / delimiter
      const encodedRepo = namespace
        ? `${encodeComponent(namespace)}/${encodeComponent(name)}`
        : encodeComponent(name)
      const url = `https://hub.docker.com/v2/repositories/${encodedRepo}`

      const data = await httpJson<{
        name?: string
      }>(url)

      // Docker Hub doesn't provide a simple "latest version" - tags need separate API call
      // For now, we just verify the repository exists
      if (!data.name) {
        return {
          exists: false,
          error: 'Image not found',
        }
      }

      // If specific tag requested, verify it exists
      if (version) {
        try {
          const tagUrl = `https://hub.docker.com/v2/repositories/${encodedRepo}/tags/${encodeComponent(version)}`
          await httpJson(tagUrl)
        } catch (e) {
          /* c8 ignore start */
          const error = e instanceof Error ? e.message : String(e)
          /* c8 ignore stop */
          return {
            exists: false,
            error: StringPrototypeIncludes(error, '404')
              ? `Tag ${version} not found`
              : error,
          }
        }
      }

      return {
        exists: true,
        latestVersion: version || 'latest',
      }
    } catch (e) {
      /* c8 ignore start */
      const error = e instanceof Error ? e.message : String(e)
      /* c8 ignore stop */
      return {
        exists: false,
        error: StringPrototypeIncludes(error, '404')
          ? 'Image not found'
          : error,
      }
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
