/**
 * @fileoverview Go module proxy existence check.
 * Queries proxy.golang.org to verify Go module existence.
 */

import { httpGetJson } from '@socketsecurity/lib/http-request'

import type { ExistsResult, ExistsOptions } from './npm.js'

/**
 * Check if a Go module exists in the Go module proxy.
 *
 * Queries proxy.golang.org to verify module existence and retrieve
 * the latest version. Go module names are typically full import paths
 * like 'github.com/user/repo'.
 *
 * @param name - Full module path (e.g., 'github.com/gorilla/mux')
 * @param namespace - Optional namespace (combined with name if provided)
 * @param version - Optional version to validate (e.g., 'v1.8.0')
 * @param options - Optional configuration including cache
 * @returns Promise resolving to existence result with latest version
 *
 * @example
 * ```typescript
 * // Check if module exists
 * const result = await golangExists('github.com/gorilla/mux')
 * // -> { exists: true, latestVersion: 'v1.8.0' }
 *
 * // With namespace (constructs full path)
 * const result = await golangExists('mux', 'github.com/gorilla')
 * // -> { exists: true, latestVersion: 'v1.8.0' }
 *
 * // Validate specific version
 * const result = await golangExists('github.com/gorilla/mux', undefined, 'v1.8.0')
 * // -> { exists: true, latestVersion: 'v1.8.0' }
 *
 * // Non-existent module
 * const result = await golangExists('github.com/fake/module')
 * // -> { exists: false, error: 'Module not found' }
 * ```
 */
export async function golangExists(
  name: string,
  namespace?: string,
  version?: string,
  options?: ExistsOptions,
): Promise<ExistsResult> {
  const modulePath = namespace ? `${namespace}/${name}` : name
  const cacheKey = version ? `${modulePath}@${version}` : modulePath

  if (options?.cache) {
    const cached = await options.cache.get<ExistsResult>(cacheKey)
    if (cached !== undefined) {
      return cached
    }
  }

  const fetchResult = async (): Promise<ExistsResult> => {
    try {
      // Encode the module path for the URL
      // Go proxy uses case-encoded paths where uppercase letters are !lowercase
      const encodedPath = modulePath
        .split('/')
        .map(part => {
          return part.replace(/[A-Z]/g, letter => `!${letter.toLowerCase()}`)
        })
        .join('/')

      const url = `https://proxy.golang.org/${encodedPath}/@latest`

      const data = await httpGetJson<{
        Version?: string
        Time?: string
      }>(url)

      const latestVersion = data.Version

      if (version) {
        const versionUrl = `https://proxy.golang.org/${encodedPath}/@v/${version}.info`
        try {
          await httpGetJson(versionUrl)
        } catch {
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
        error:
          error.includes('404') || error.includes('410')
            ? 'Module not found'
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
