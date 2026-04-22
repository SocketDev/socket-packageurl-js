/**
 * @fileoverview VSCode extension PURL normalization and validation.
 * https://github.com/package-url/purl-spec/blob/master/PURL-TYPES.rst
 *
 * VSCode extensions use the Visual Studio Marketplace for distribution.
 * The namespace is the publisher name, and the name is the extension name.
 */

import { httpJson } from '@socketsecurity/lib/http-request'

import { errorMessage, PurlError } from '../error.js'
import {
  ArrayPrototypeSome,
  JSONStringify,
  StringPrototypeIncludes,
} from '../primordials.js'
import {
  isSemverString,
  lowerName,
  lowerNamespace,
  lowerVersion,
} from '../strings.js'
import {
  validateNoInjectionByType,
  validateRequiredByType,
} from '../validate.js'

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
 * Normalize VSCode extension package URL.
 * Lowercases namespace (publisher), name (extension), and version per spec.
 * Spec: namespace, name, and version are all case-insensitive.
 */
export function normalize(purl: PurlObject): PurlObject {
  lowerNamespace(purl)
  lowerName(purl)
  lowerVersion(purl)
  return purl
}

/**
 * Validate VSCode extension package URL.
 * Checks namespace (publisher) and name (extension) for injection characters,
 * and validates version as semver when present.
 */
export function validate(purl: PurlObject, throws: boolean): boolean {
  const { name, namespace, version, qualifiers } = purl
  // VSCode extensions require a namespace (publisher)
  if (
    !validateRequiredByType('vscode-extension', 'namespace', namespace, {
      throws,
    })
  ) {
    return false
  }
  // Namespace must not contain injection characters
  if (
    !validateNoInjectionByType(
      'vscode-extension',
      'namespace',
      namespace,
      throws,
    )
  ) {
    return false
  }
  // Name must not contain injection characters
  if (!validateNoInjectionByType('vscode-extension', 'name', name, throws)) {
    return false
  }
  // Version must be valid semver when present
  if (
    typeof version === 'string' &&
    version.length > 0 &&
    !isSemverString(version)
  ) {
    if (throws) {
      throw new PurlError(
        'vscode-extension "version" component must be a valid semver version',
      )
    }
    return false
  }
  // Platform qualifier must not contain injection characters
  if (
    !validateNoInjectionByType(
      'vscode-extension',
      'platform',
      qualifiers?.['platform'],
      throws,
    )
  ) {
    return false
  }
  return true
}

/**
 * Check if a VSCode extension exists in the Visual Studio Marketplace.
 *
 * Queries the VS Marketplace API to verify extension existence and optionally
 * validate a specific version. Returns the latest version from extension metadata.
 *
 * **Note:** VS Marketplace requires specific headers for API access.
 *
 * **Caching:** Responses can be cached using a TTL cache to reduce registry
 * requests. Pass `{ cache }` option with a cache instance from `createTtlCache()`.
 *
 * @param name - Extension name (e.g., 'vscode-eslint')
 * @param namespace - Publisher name (e.g., 'dbaeumer')
 * @param version - Optional version to validate (e.g., '2.4.2')
 * @param options - Optional configuration including cache
 * @returns Promise resolving to existence result with latest version
 *
 * @example
 * ```typescript
 * // Check if extension exists
 * const result = await vscodeExtensionExists('vscode-eslint', 'dbaeumer')
 * // -> { exists: true, latestVersion: '2.4.2' }
 *
 * // Validate specific version
 * const result = await vscodeExtensionExists('vscode-eslint', 'dbaeumer', '2.4.0')
 * // -> { exists: true, latestVersion: '2.4.2' }
 *
 * // With caching
 * import { createTtlCache } from '@socketsecurity/lib/cache-with-ttl'
 * const cache = createTtlCache({ ttl: 5 * 60 * 1000, prefix: 'vscode' })
 * const result = await vscodeExtensionExists('vscode-eslint', 'dbaeumer', undefined, { cache })
 *
 * // Non-existent extension
 * const result = await vscodeExtensionExists('non-existent', 'publisher')
 * // -> { exists: false, error: 'Extension not found' }
 * ```
 */
export async function vscodeExtensionExists(
  name: string,
  namespace?: string,
  version?: string,
  options?: ExistsOptions,
): Promise<ExistsResult> {
  if (!namespace) {
    return {
      exists: false,
      error: 'Namespace (publisher) is required for VSCode extensions',
    }
  }

  const extensionId = `${namespace}.${name}`
  const cacheKey = version
    ? `vscode-extension:${extensionId}@${version}`
    : `vscode-extension:${extensionId}`

  // Try cache first if provided
  if (options?.cache) {
    const cached = await options.cache.get<ExistsResult>(cacheKey)
    if (cached !== undefined) {
      return cached
    }
  }

  const fetchResult = async (): Promise<ExistsResult> => {
    try {
      // VS Marketplace API endpoint
      const url =
        'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery'

      const requestBody = {
        filters: [
          {
            criteria: [
              {
                filterType: 7,
                value: extensionId,
              },
            ],
          },
        ],
        flags: 914,
      }

      const data = await httpJson<{
        results?: Array<{
          extensions?: Array<{
            versions?: Array<{
              version?: string
            }>
          }>
        }>
      }>(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json;api-version=7.1-preview.1',
        },
        body: JSONStringify(requestBody),
      })

      const extensions = data.results?.[0]?.['extensions']
      if (!extensions || extensions.length === 0) {
        return {
          exists: false,
          error: 'Extension not found',
        }
      }

      const versions = extensions[0]?.['versions']
      const latestVersion = versions?.[0]?.['version']

      // If specific version requested, validate it exists
      if (version && versions) {
        const versionExists = ArrayPrototypeSome(
          versions,
          v => v.version === version,
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

      const result: ExistsResult = {
        exists: true,
      }
      if (latestVersion !== undefined) {
        result.latestVersion = latestVersion
      }
      return result
    } catch (e) {
      /* v8 ignore start */
      const error = errorMessage(e)
      /* v8 ignore stop */
      // IMPORTANT: httpJson() throws on non-2xx responses, so we cannot inspect
      // response.status directly. We rely on the error message containing "404"
      // to distinguish "not found" from other HTTP errors.
      // This depends on @socketsecurity/lib's error message format:
      // "HTTP 404: Not Found" or similar containing the status code.
      // If upstream changes error format, this string matching may break.
      return {
        exists: false,
        error: StringPrototypeIncludes(error, '404')
          ? 'Extension not found'
          : error,
      }
    }
  }

  const result = await fetchResult()

  // Only cache successful results to avoid negative cache poisoning
  // from transient failures (network errors, 5xx responses)
  if (options?.cache && result.exists) {
    await options.cache.set(cacheKey, Object.freeze(result))
  }

  return result
}
