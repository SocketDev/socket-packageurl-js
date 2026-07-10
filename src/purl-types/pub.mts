/**
 * @file Pub (Dart/Flutter) PURL normalization and validation.
 *   https://github.com/package-url/purl-spec/blob/main/PURL-TYPES.rst#pub.
 */

import { httpJson } from '@socketsecurity/lib/http-request'

import { errorMessage, PurlError } from '../error.mjs'
import { ArrayPrototypeSome } from '@socketsecurity/lib/primordials/array'
import { encodeURIComponent as GlobalEncodeUriComponent } from '@socketsecurity/lib/primordials/globals'
import {
  StringPrototypeCharCodeAt,
  StringPrototypeIncludes,
} from '@socketsecurity/lib/primordials/string'
import { lowerName, replaceDashesWithUnderscores } from '../strings.mjs'

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
 * Normalize Pub package URL. Lowercases `name` and replaces dashes with
 * underscores.
 */
export function normalize(purl: PurlObject): PurlObject {
  lowerName(purl)
  purl.name = replaceDashesWithUnderscores(purl.name)
  return purl
}

/**
 * Check if a Dart/Flutter package exists on pub.dev.
 *
 * Queries pub.dev API to verify package existence and retrieve the latest
 * version.
 *
 * @example
 *   ;```typescript
 *   // Check if package exists
 *   const result = await pubExists('flutter_bloc')
 *   // -> { exists: true, latestVersion: '8.1.3' }
 *
 *   // Validate specific version
 *   const result = await pubExists('flutter_bloc', '8.1.3')
 *   // -> { exists: true, latestVersion: '8.1.3' }
 *
 *   // Non-existent package
 *   const result = await pubExists('fake_package')
 *   // -> { exists: false, error: 'Package not found' }
 *   ```
 *
 * @param name - Package name (e.g., `'flutter_bloc'`)
 * @param version - Optional version to validate (e.g., `'8.1.3'`)
 * @param options - Optional configuration including `cache`
 *
 * @returns `Promise` resolving to existence result with latest version
 */
export async function pubExists(
  name: string,
  version?: string,
  options?: ExistsOptions,
): Promise<ExistsResult> {
  const opts = { __proto__: null, ...options } as typeof options
  const cacheKey = version ? `pub:${name}@${version}` : `pub:${name}`

  if (opts?.cache) {
    const cached = await opts.cache.get<ExistsResult>(cacheKey)
    if (cached !== undefined) {
      return cached
    }
  }

  const fetchResult = async (): Promise<ExistsResult> => {
    try {
      const url = `https://pub.dev/api/packages/${GlobalEncodeUriComponent(name)}`

      const data = await httpJson<{
        latest?:
          | {
              version?: string | undefined
            }
          | undefined
        versions?:
          | Array<{
              version?: string | undefined
            }>
          | undefined
      }>(url)

      const latestVersion = data.latest?.['version']

      if (version) {
        const versions = data.versions || []
        const versionExists = ArrayPrototypeSome(
          versions,
          (v: { version?: string | undefined }) => v.version === version,
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

/**
 * Validate Pub package URL. `name` may only contain `[a-z0-9_]` characters.
 */
export function validate(
  purl: PurlObject,
  options?: { throws?: boolean | undefined } | undefined,
): boolean {
  const { throws = false } = options ?? {}
  const { name } = purl
  for (let i = 0, { length } = name; i < length; i += 1) {
    const code = StringPrototypeCharCodeAt(name, i)
    // biome-ignore format: newlines
    if (
      !(
        // 0-9
        (
          (code >= 48 && code <= 57) ||
          // a-z
          (code >= 97 && code <= 122) ||
          code === 95
        )
        // _
      )
    ) {
      if (throws) {
        // Tested: validation returns false in non-throw mode
        // V8 coverage can't see both throw and return false paths in same test
        /* v8 ignore next 3 -- Throw path tested separately from return false path. */
        throw new PurlError(
          'pub "name" component may only contain [a-z0-9_] characters',
        )
      }
      return false
    }
  }
  return true
}
