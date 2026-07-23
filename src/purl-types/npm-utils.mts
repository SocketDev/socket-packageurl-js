/**
 * @file Shared types, helpers, and utilities for `npm` PURL operations.
 *   Includes builtin/legacy name lookups, ID helpers, normalization, registry
 *   existence checks, and specifier parsing.
 */
import { builtinModules } from 'node:module'

import { httpJson } from '@socketsecurity/lib/http-request'

import { encodeComponent } from '../encode.mjs'
import { errorMessage } from '../error.mjs'
import { ErrorCtor } from '@socketsecurity/lib/primordials/error'
import { SetCtor } from '@socketsecurity/lib/primordials/map-set'
import {
  StringPrototypeIncludes,
  StringPrototypeIndexOf,
  StringPrototypeReplace,
  StringPrototypeSlice,
  StringPrototypeStartsWith,
  StringPrototypeToLowerCase,
} from '@socketsecurity/lib/primordials/string'
import { isBlank, lowerName, lowerNamespace } from '../strings.mjs'

import type { TtlCache } from '@socketsecurity/lib/cache/ttl/types'

export interface PurlObject {
  name: string
  namespace?: string | undefined
  qualifiers?: Record<string, string> | undefined
  subpath?: string | undefined
  type?: string | undefined
  version?: string | undefined
}

/**
 * Result of package existence check.
 */
export type ExistsResult = {
  exists: boolean
  latestVersion?: string | undefined
  error?: string | undefined
}

/**
 * Options for registry existence checks.
 */
export type ExistsOptions = {
  /**
   * Optional TTL cache instance for caching registry responses. If provided,
   * responses will be cached with configured TTL.
   *
   * @example
   *   ;```typescript
   *   import { createTtlCache } from '@socketsecurity/lib/cache/ttl/store'
   *   import { npmExists } from '@socketregistry/packageurl-js'
   *
   *   const cache = createTtlCache({
   *     ttl: 5 * 60 * 1000,
   *     prefix: 'npm-registry',
   *   })
   *   const result = await npmExists('lodash', undefined, undefined, { cache })
   *   ```
   */
  cache?: TtlCache | undefined
}

/**
 * Components parsed from npm package specifier. Includes namespace (for scoped
 * packages), name, and version.
 */
export type NpmPackageComponents = {
  namespace: string | undefined
  name: string
  version: string | undefined
}

let builtinSet: Set<string> | undefined

/**
 * Get `Set` of Node.js built-in module names for O(1) lookups. Derived from
 * the running Node's `builtinModules` (rolldown externalizes builtins, so the
 * CJS dist carries this as a plain `require('node:module')`).
 */
export function getNpmBuiltinSet(): Set<string> {
  if (builtinSet === undefined) {
    builtinSet = new SetCtor(builtinModules)
  }
  return builtinSet
}

/**
 * Get `npm` package identifier with optional namespace.
 */
export function getNpmId(purl: PurlObject): string {
  const { name, namespace } = purl
  return `${namespace && namespace.length > 0 ? `${namespace}/` : ''}${name}`
}

let legacySet: Set<string> | undefined

/**
 * Get `Set` of `npm` legacy package names for O(1) lookups.
 */
export function getNpmLegacySet(): Set<string> {
  if (legacySet === undefined) {
    let fullLegacyNames: string[]
    /* v8 ignore start - Fallback path only used if JSON file fails to load. */
    try {
      // Try to load the full list from JSON file
      fullLegacyNames = require('../../data/npm/legacy-names.json')
    } catch {
      // Fallback to hardcoded builtin names for simplicity
      fullLegacyNames = [
        'assert',
        'buffer',
        'crypto',
        'events',
        'fs',
        'http',
        'os',
        'path',
        'url',
        'util',
      ]
    }
    /* v8 ignore stop */
    legacySet = new SetCtor(fullLegacyNames)
  }
  return legacySet
}

/**
 * Check if `npm` identifier is a Node.js built-in module name.
 */
export function isNpmBuiltinName(id: string) {
  return getNpmBuiltinSet().has(StringPrototypeToLowerCase(id))
}

/**
 * Check if `npm` identifier is a legacy package name.
 */
export function isNpmLegacyName(id: string) {
  return getNpmLegacySet().has(id)
}

/**
 * Normalize `npm` package URL.
 * https://github.com/package-url/purl-spec/blob/main/PURL-TYPES.rst#npm.
 */
export function normalize(purl: PurlObject): PurlObject {
  lowerNamespace(purl)
  // Ignore lowercasing legacy names because they could be mixed case
  // https://github.com/npm/validate-npm-package-name/tree/v6.0.0?tab=readme-ov-file#legacy-names
  if (!isNpmLegacyName(getNpmId(purl))) {
    lowerName(purl)
  }
  return purl
}

/**
 * Check if an npm package exists in the registry.
 *
 * Queries the npm registry at https://registry.npmjs.org to verify package
 * existence and optionally validate a specific version. Returns the latest
 * version from `dist-tags`.
 *
 * **Caching:** Responses can be cached using a TTL cache to reduce registry
 * requests. Pass `{ cache }` option with a cache instance from
 * `createTtlCache()`.
 *
 * @example
 *   ;```typescript
 *   // Check if package exists
 *   const result = await npmExists('lodash')
 *   // -> { exists: true, latestVersion: '4.17.21' }
 *
 *   // Check scoped package
 *   const result = await npmExists('core', '@babel')
 *   // -> { exists: true, latestVersion: '7.23.0' }
 *
 *   // Validate specific version
 *   const result = await npmExists('lodash', undefined, '4.17.21')
 *   // -> { exists: true, latestVersion: '4.17.21' }
 *
 *   // With caching
 *   import { createTtlCache } from '@socketsecurity/lib/cache/ttl/store'
 *   const cache = createTtlCache({ ttl: 5 * 60 * 1000, prefix: 'npm' })
 *   const result = await npmExists('lodash', undefined, undefined, { cache })
 *
 *   // Non-existent package
 *   const result = await npmExists('this-package-does-not-exist')
 *   // -> { exists: false, error: 'Package not found' }
 *   ```
 *
 * @param name - Package name (e.g., `'lodash'`, `'core'` for scoped packages)
 * @param namespace - Optional namespace/scope (e.g., `'@babel'`)
 * @param version - Optional version to validate (e.g., `'4.17.21'`)
 * @param options - Optional configuration including `cache`
 *
 * @returns `Promise` resolving to existence result with latest version
 */
export async function npmExists(
  name: string,
  namespace?: string | undefined,
  version?: string | undefined,
  options?: ExistsOptions | undefined,
): Promise<ExistsResult> {
  // Build cache key
  const opts = { __proto__: null, ...options } as typeof options
  const packageName = namespace ? `${namespace}/${name}` : name
  const cacheKey = version
    ? `npm:${packageName}@${version}`
    : `npm:${packageName}`

  // Try cache first if provided
  if (opts?.cache) {
    const cached = await opts.cache.get<ExistsResult>(cacheKey)
    if (cached !== undefined) {
      return cached
    }
  }

  const fetchResult = async (): Promise<ExistsResult> => {
    try {
      const encodedName = encodeComponent(packageName)
      const url = `https://registry.npmjs.org/${encodedName}`

      const data = await httpJson<{
        'dist-tags'?: { latest?: string | undefined } | undefined
        versions?: Record<string, unknown> | undefined
      }>(url)

      const latestVersion = data['dist-tags']?.['latest']

      // If specific version requested, validate it exists
      if (version && data.versions) {
        if (!(version in data.versions)) {
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
      /* v8 ignore start - httpJson typically throws Error; String(e) is defensive programming */
      // `httpJson` throws on non-2xx status codes
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
 * Parse npm package specifier into component data.
 *
 * Parses npm package specifiers into `namespace`, `name`, and `version`
 * components. Handles scoped packages, version ranges, and normalizes version
 * strings.
 *
 * **Supported formats:**
 *
 * - Basic packages: `lodash`, `lodash@4.17.21`
 * - Scoped packages: `@babel/core`, `@babel/core@7.0.0`
 * - Version ranges: `^4.17.21`, `~1.2.3`, `>=1.0.0` (prefixes stripped)
 * - Dist-tags: `latest`, `next`, `beta` (passed through as version)
 *
 * **Not supported:**
 *
 * - Git URLs: `git+https://...`
 * - File paths: `file:../package.tgz`
 * - GitHub shortcuts: `user/repo#branch`
 * - Aliases: `npm:package@version`
 *
 * **Note:** Dist-tags like `latest` are mutable and should be resolved to
 * concrete versions for reproducible builds. This method passes them through
 * as-is for convenience.
 *
 * @example
 *   ;```typescript
 *   // Basic packages
 *   parseNpmSpecifier('lodash@4.17.21')
 *   // -> { namespace: undefined, name: 'lodash', version: '4.17.21' }
 *
 *   // Scoped packages
 *   parseNpmSpecifier('@babel/core@^7.0.0')
 *   // -> { namespace: '@babel', name: 'core', version: '7.0.0' }
 *
 *   // Dist-tags (passed through)
 *   parseNpmSpecifier('react@latest')
 *   // -> { namespace: undefined, name: 'react', version: 'latest' }
 *
 *   // No version
 *   parseNpmSpecifier('express')
 *   // -> { namespace: undefined, name: 'express', version: undefined }
 *   ```
 *
 * @param specifier - Npm package specifier (e.g., `'lodash@4.17.21'`,
 *   `'@babel/core@^7.0.0'`)
 *
 * @returns Object with `namespace`, `name`, and `version` components
 *
 * @throws {Error} If `specifier` is not a string or is empty
 */
export function parseNpmSpecifier(specifier: unknown): NpmPackageComponents {
  if (typeof specifier !== 'string') {
    throw new ErrorCtor('npm package specifier string is required.')
  }

  if (isBlank(specifier)) {
    throw new ErrorCtor('npm package specifier cannot be empty.')
  }

  // Handle scoped packages: `@scope/name@version`
  let namespace: string | undefined
  let name: string
  let version: string | undefined

  // Check if it's a scoped package
  if (StringPrototypeStartsWith(specifier, '@')) {
    // Find the second slash (after `@scope/`)
    const slashIndex = StringPrototypeIndexOf(specifier, '/')
    if (slashIndex === -1) {
      throw new ErrorCtor(
        'npm scoped specifier must contain "/" after scope (e.g. "@scope/name").',
      )
    }

    // Find the `@` after the scope
    const atIndex = StringPrototypeIndexOf(specifier, '@', slashIndex)
    if (atIndex === -1) {
      // No version specified
      namespace = StringPrototypeSlice(specifier, 0, slashIndex)
      name = StringPrototypeSlice(specifier, slashIndex + 1)
    } else {
      namespace = StringPrototypeSlice(specifier, 0, slashIndex)
      name = StringPrototypeSlice(specifier, slashIndex + 1, atIndex)
      version = StringPrototypeSlice(specifier, atIndex + 1)
    }
  } else {
    // Non-scoped package: `name@version`
    const atIndex = StringPrototypeIndexOf(specifier, '@')
    if (atIndex === -1) {
      // No version specified
      name = specifier
    } else {
      name = StringPrototypeSlice(specifier, 0, atIndex)
      version = StringPrototypeSlice(specifier, atIndex + 1)
    }
  }

  // Clean up version - remove common npm range prefixes
  if (version) {
    // Remove leading `^`, `~`, `>=`, `<=`, `>`, `<`, `=`
    version = StringPrototypeReplace(version, /^[\^~>=<]+/, '')
    // Handle version ranges like `"1.0.0 - 2.0.0"` by taking first version
    const spaceIndex = StringPrototypeIndexOf(version, ' ')
    if (spaceIndex !== -1) {
      version = StringPrototypeSlice(version, 0, spaceIndex)
    }
  }

  return { namespace, name, version }
}
