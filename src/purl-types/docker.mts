/**
 * @file Docker-specific PURL normalization and validation.
 *   https://github.com/package-url/purl-spec/blob/main/PURL-TYPES.rst#docker.
 */

import { errorMessage } from '../error.mjs'
import { httpJson } from '@socketsecurity/lib/http-request'

import { encodeURIComponent as GlobalEncodeUriComponent } from '@socketsecurity/lib/primordials/globals'
import { StringPrototypeIncludes } from '@socketsecurity/lib/primordials/string'
import { lowerName, lowerNamespace } from '../strings.mjs'
import { validateNoInjectionByType } from '../validate.mjs'

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
 * Options for `dockerExists()`. Extends the shared registry existence options
 * with the Docker-specific `namespace` and `version` (tag) fields.
 */
export type DockerExistsOptions = ExistsOptions & {
  /**
   * Optional namespace/repository (e.g., `'library'` for official images).
   */
  namespace?: string | undefined
  /**
   * Optional tag to validate (e.g., `'latest'`, `'1.25.3'`).
   */
  version?: string | undefined
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
 * requests. Pass `{ cache }` option with a cache instance from
 * `createTtlCache()`.
 *
 * @example
 *   ;```typescript
 *   // Check if official image exists
 *   const result = await dockerExists('nginx', { namespace: 'library' })
 *   // -> { exists: true, latestVersion: 'latest' }
 *
 *   // Check user image
 *   const result = await dockerExists('myapp', { namespace: 'myuser' })
 *   // -> { exists: true, latestVersion: 'v1.0.0' }
 *
 *   // Validate specific tag
 *   const result = await dockerExists('nginx', {
 *     namespace: 'library',
 *     version: '1.25.3',
 *   })
 *   // -> { exists: true, latestVersion: 'latest' }
 *
 *   // With caching
 *   import { createTtlCache } from '@socketsecurity/lib/cache/ttl/store'
 *   const cache = createTtlCache({ ttl: 5 * 60 * 1000, prefix: 'docker' })
 *   const result = await dockerExists('nginx', { namespace: 'library', cache })
 *
 *   // Non-existent image
 *   const result = await dockerExists('this-image-does-not-exist', {
 *     namespace: 'library',
 *   })
 *   // -> { exists: false, error: 'Image not found' }
 *   ```
 *
 * @param name - Image name (e.g., `'nginx'`, `'redis'`)
 * @param options - Optional configuration including `namespace` (repository),
 *   `version` (tag), and `cache`
 *
 * @returns `Promise` resolving to existence result with latest tag
 */
export async function dockerExists(
  name: string,
  options?: DockerExistsOptions | undefined,
): Promise<ExistsResult> {
  // Default namespace to `'library'` for official images if not specified
  const opts = { __proto__: null, ...options } as DockerExistsOptions
  const { namespace, version } = opts
  const repo = namespace ? `${namespace}/${name}` : name
  const cacheKey = version ? `docker:${repo}:${version}` : `docker:${repo}`

  // Try cache first if provided
  if (opts?.cache) {
    const cached = await opts.cache.get<ExistsResult>(cacheKey)
    if (cached !== undefined) {
      return cached
    }
  }

  const fetchResult = async (): Promise<ExistsResult> => {
    try {
      // Encode each path segment separately to preserve the `/` delimiter
      const encodedRepo = namespace
        ? `${GlobalEncodeUriComponent(namespace)}/${GlobalEncodeUriComponent(name)}`
        : GlobalEncodeUriComponent(name)
      const url = `https://hub.docker.com/v2/repositories/${encodedRepo}`

      const data = await httpJson<{
        name?: string | undefined
      }>(url)

      // Docker Hub doesn't provide a simple `"latest version"` - tags need separate API call
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
          const tagUrl = `https://hub.docker.com/v2/repositories/${encodedRepo}/tags/${GlobalEncodeUriComponent(version)}`
          await httpJson(tagUrl)
        } catch (e) {
          /* v8 ignore start */
          const error = errorMessage(e)
          /* v8 ignore stop */
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
      /* v8 ignore start */
      const error = errorMessage(e)
      /* v8 ignore stop */
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
  if (opts?.cache && result.exists) {
    await opts.cache.set(cacheKey, Object.freeze(result))
  }

  return result
}

/**
 * Validate Docker package URL. `name` and `namespace` must not contain
 * injection characters.
 */
export function dockerValidate(
  purl: PurlObject,
  options?: { throws?: boolean | undefined } | undefined,
): boolean {
  const { throws = false } = options ?? {}
  if (
    !validateNoInjectionByType('docker', 'namespace', purl.namespace, {
      throws,
    })
  ) {
    return false
  }
  if (!validateNoInjectionByType('docker', 'name', purl.name, { throws })) {
    return false
  }
  return true
}

/**
 * Normalize Docker package URL. Lowercases `namespace` (user/org) and `name`.
 * The distribution/reference grammar makes every path-component (the user/org
 * namespace segment and the image name) lowercase-only — `docker pull` rejects
 * uppercase — and a registry host belongs in `repository_url`, never the
 * namespace, so folding the namespace is never lossy. The version (a tag or
 * sha256 id) is preserved.
 */
export function normalize(purl: PurlObject): PurlObject {
  lowerNamespace(purl)
  lowerName(purl)
  return purl
}
