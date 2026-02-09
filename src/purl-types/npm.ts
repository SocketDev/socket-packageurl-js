/**
 * @fileoverview npm-specific PURL normalization and validation.
 * Implements npm package naming rules from the PURL specification.
 */

import { httpJson } from '@socketsecurity/lib/http-request'

import { encodeComponent } from '../encode.js'
import { PurlError } from '../error.js'
import { isBlank, lowerName, lowerNamespace } from '../strings.js'

import type { TtlCache } from '@socketsecurity/lib/cache-with-ttl'

interface PurlObject {
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
  latestVersion?: string
  error?: string
}

/**
 * Options for registry existence checks.
 */
export type ExistsOptions = {
  /**
   * Optional TTL cache instance for caching registry responses.
   * If provided, responses will be cached with configured TTL.
   *
   * @example
   * ```typescript
   * import { createTtlCache } from '@socketsecurity/lib/cache-with-ttl'
   * import { npmExists } from '@socketregistry/packageurl-js'
   *
   * const cache = createTtlCache({ ttl: 5 * 60 * 1000, prefix: 'npm-registry' })
   * const result = await npmExists('lodash', undefined, undefined, { cache })
   * ```
   */
  cache?: TtlCache
}

/**
 * Components parsed from npm package specifier.
 * Includes namespace (for scoped packages), name, and version.
 */
export type NpmPackageComponents = {
  namespace: string | undefined
  name: string
  version: string | undefined
}

/**
 * Get list of Node.js built-in module names.
 */
const getNpmBuiltinNames = (() => {
  let builtinNames: string[] | undefined
  return () => {
    if (builtinNames === undefined) {
      /* c8 ignore start - Error handling for module access. */
      try {
        // Try to use Node.js builtinModules first
        builtinNames = (module.constructor as { builtinModules?: string[] })
          ?.builtinModules
      } catch {}
      /* c8 ignore stop */
      if (!builtinNames) {
        // Fallback to hardcoded list
        builtinNames = [
          'assert',
          'async_hooks',
          'buffer',
          'child_process',
          'cluster',
          'console',
          'constants',
          'crypto',
          'dgram',
          'diagnostics_channel',
          'dns',
          'domain',
          'events',
          'fs',
          'http',
          'http2',
          'https',
          'inspector',
          'module',
          'net',
          'os',
          'path',
          'perf_hooks',
          'process',
          'punycode',
          'querystring',
          'readline',
          'repl',
          'stream',
          'string_decoder',
          'sys',
          'timers',
          'tls',
          'trace_events',
          'tty',
          'url',
          'util',
          'v8',
          'vm',
          'wasi',
          'worker_threads',
          'zlib',
        ]
      }
    }
    return builtinNames
  }
})()

/**
 * Get npm package identifier with optional namespace.
 */
function getNpmId(purl: PurlObject): string {
  const { name, namespace } = purl
  return `${namespace && namespace.length > 0 ? `${namespace}/` : ''}${name}`
}

/**
 * Get list of npm legacy package names.
 */
const getNpmLegacyNames = (() => {
  let fullLegacyNames: string[] | undefined

  return (): string[] => {
    if (fullLegacyNames === undefined) {
      /* c8 ignore start - Fallback path only used if JSON file fails to load. */
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
      /* c8 ignore stop */
    }
    return fullLegacyNames!
  }
})()

/**
 * Check if npm identifier is a Node.js built-in module name.
 */
const isNpmBuiltinName = (id: string): boolean =>
  getNpmBuiltinNames().includes(id.toLowerCase())

/**
 * Check if npm identifier is a legacy package name.
 */
const isNpmLegacyName = (id: string): boolean =>
  getNpmLegacyNames().includes(id)

/**
 * Normalize npm package URL.
 * https://github.com/package-url/purl-spec/blob/master/PURL-TYPES.rst#npm
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
 * version from dist-tags.
 *
 * **Caching:** Responses can be cached using a TTL cache to reduce registry
 * requests. Pass `{ cache }` option with a cache instance from `createTtlCache()`.
 *
 * @param name - Package name (e.g., 'lodash', 'core' for scoped packages)
 * @param namespace - Optional namespace/scope (e.g., '@babel')
 * @param version - Optional version to validate (e.g., '4.17.21')
 * @param options - Optional configuration including cache
 * @returns Promise resolving to existence result with latest version
 *
 * @example
 * ```typescript
 * // Check if package exists
 * const result = await npmExists('lodash')
 * // -> { exists: true, latestVersion: '4.17.21' }
 *
 * // Check scoped package
 * const result = await npmExists('core', '@babel')
 * // -> { exists: true, latestVersion: '7.23.0' }
 *
 * // Validate specific version
 * const result = await npmExists('lodash', undefined, '4.17.21')
 * // -> { exists: true, latestVersion: '4.17.21' }
 *
 * // With caching
 * import { createTtlCache } from '@socketsecurity/lib/cache-with-ttl'
 * const cache = createTtlCache({ ttl: 5 * 60 * 1000, prefix: 'npm' })
 * const result = await npmExists('lodash', undefined, undefined, { cache })
 *
 * // Non-existent package
 * const result = await npmExists('this-package-does-not-exist')
 * // -> { exists: false, error: 'Package not found' }
 * ```
 */
export async function npmExists(
  name: string,
  namespace?: string,
  version?: string,
  options?: ExistsOptions,
): Promise<ExistsResult> {
  // Build cache key
  const packageName = namespace ? `${namespace}/${name}` : name
  const cacheKey = version ? `${packageName}@${version}` : packageName

  // Try cache first if provided
  if (options?.cache) {
    const cached = await options.cache.get<ExistsResult>(cacheKey)
    if (cached !== undefined) {
      return cached
    }
  }

  const fetchResult = async (): Promise<ExistsResult> => {
    try {
      const encodedName = encodeURIComponent(packageName)
      const url = `https://registry.npmjs.org/${encodedName}`

      const data = await httpJson<{
        'dist-tags'?: { latest?: string }
        versions?: Record<string, unknown>
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
      /* c8 ignore next - httpJson typically throws Error; String(e) is defensive programming */
      // httpJson throws on non-2xx status codes
      const error = e instanceof Error ? e.message : String(e)
      return {
        exists: false,
        error: error.includes('404') ? 'Package not found' : error,
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
 * Parse npm package specifier into component data.
 *
 * Parses npm package specifiers into namespace, name, and version components.
 * Handles scoped packages, version ranges, and normalizes version strings.
 *
 * **Supported formats:**
 * - Basic packages: `lodash`, `lodash@4.17.21`
 * - Scoped packages: `@babel/core`, `@babel/core@7.0.0`
 * - Version ranges: `^4.17.21`, `~1.2.3`, `>=1.0.0` (prefixes stripped)
 * - Dist-tags: `latest`, `next`, `beta` (passed through as version)
 *
 * **Not supported:**
 * - Git URLs: `git+https://...`
 * - File paths: `file:../package.tgz`
 * - GitHub shortcuts: `user/repo#branch`
 * - Aliases: `npm:package@version`
 *
 * **Note:** Dist-tags like `latest` are mutable and should be resolved to
 * concrete versions for reproducible builds. This method passes them through
 * as-is for convenience.
 *
 * @param specifier - npm package specifier (e.g., 'lodash@4.17.21', '@babel/core@^7.0.0')
 * @returns Object with namespace, name, and version components
 * @throws {Error} If specifier is not a string or is empty
 *
 * @example
 * ```typescript
 * // Basic packages
 * parseNpmSpecifier('lodash@4.17.21')
 * // -> { namespace: undefined, name: 'lodash', version: '4.17.21' }
 *
 * // Scoped packages
 * parseNpmSpecifier('@babel/core@^7.0.0')
 * // -> { namespace: '@babel', name: 'core', version: '7.0.0' }
 *
 * // Dist-tags (passed through)
 * parseNpmSpecifier('react@latest')
 * // -> { namespace: undefined, name: 'react', version: 'latest' }
 *
 * // No version
 * parseNpmSpecifier('express')
 * // -> { namespace: undefined, name: 'express', version: undefined }
 * ```
 */
export function parseNpmSpecifier(specifier: unknown): NpmPackageComponents {
  if (typeof specifier !== 'string') {
    throw new Error('npm package specifier string is required.')
  }

  if (isBlank(specifier)) {
    throw new Error('npm package specifier cannot be empty.')
  }

  // Handle scoped packages: @scope/name@version
  let namespace: string | undefined
  let name: string
  let version: string | undefined

  // Check if it's a scoped package
  if (specifier.startsWith('@')) {
    // Find the second slash (after @scope/)
    const slashIndex = specifier.indexOf('/')
    if (slashIndex === -1) {
      throw new Error('Invalid scoped package specifier.')
    }

    // Find the @ after the scope
    const atIndex = specifier.indexOf('@', slashIndex)
    if (atIndex === -1) {
      // No version specified
      namespace = specifier.slice(0, slashIndex)
      name = specifier.slice(slashIndex + 1)
    } else {
      namespace = specifier.slice(0, slashIndex)
      name = specifier.slice(slashIndex + 1, atIndex)
      version = specifier.slice(atIndex + 1)
    }
  } else {
    // Non-scoped package: name@version
    const atIndex = specifier.indexOf('@')
    if (atIndex === -1) {
      // No version specified
      name = specifier
    } else {
      name = specifier.slice(0, atIndex)
      version = specifier.slice(atIndex + 1)
    }
  }

  // Clean up version - remove common npm range prefixes
  if (version) {
    // Remove leading ^, ~, >=, <=, >, <, =
    version = version.replace(/^[\^~>=<]+/, '')
    // Handle version ranges like "1.0.0 - 2.0.0" by taking first version
    const spaceIndex = version.indexOf(' ')
    if (spaceIndex !== -1) {
      version = version.slice(0, spaceIndex)
    }
  }

  return { namespace, name, version }
}

/**
 * Validate npm package URL.
 * Validation based on https://github.com/npm/validate-npm-package-name/tree/v6.0.0
 * ISC License
 * Copyright (c) 2015, npm, Inc
 */
export function validate(purl: PurlObject, throws: boolean): boolean {
  const { name, namespace } = purl
  const hasNs = namespace && namespace.length > 0
  const id = getNpmId(purl)
  const code0 = id.charCodeAt(0)
  const compName = hasNs ? 'namespace' : 'name'
  if (code0 === 46 /*'.'*/) {
    if (throws) {
      throw new PurlError(
        `npm "${compName}" component cannot start with a period`,
      )
    }
    return false
  }
  if (code0 === 95 /*'_'*/) {
    if (throws) {
      throw new PurlError(
        `npm "${compName}" component cannot start with an underscore`,
      )
    }
    return false
  }
  if (name.trim() !== name) {
    if (throws) {
      throw new PurlError(
        'npm "name" component cannot contain leading or trailing spaces',
      )
    }
    return false
  }
  if (encodeComponent(name) !== name) {
    if (throws) {
      throw new PurlError(
        `npm "name" component can only contain URL-friendly characters`,
      )
    }
    return false
  }
  if (hasNs) {
    if (namespace?.trim() !== namespace) {
      if (throws) {
        throw new PurlError(
          'npm "namespace" component cannot contain leading or trailing spaces',
        )
      }
      return false
    }
    if (code0 !== 64 /*'@'*/) {
      if (throws) {
        throw new PurlError(
          `npm "namespace" component must start with an "@" character`,
        )
      }
      return false
    }
    const namespaceWithoutAtSign = namespace?.slice(1)
    if (encodeComponent(namespaceWithoutAtSign) !== namespaceWithoutAtSign) {
      if (throws) {
        throw new PurlError(
          `npm "namespace" component can only contain URL-friendly characters`,
        )
      }
      return false
    }
  }
  const loweredId = id.toLowerCase()
  if (loweredId === 'node_modules' || loweredId === 'favicon.ico') {
    if (throws) {
      throw new PurlError(
        `npm "${compName}" component of "${loweredId}" is not allowed`,
      )
    }
    return false
  }
  // The remaining checks are only for modern names
  // https://github.com/npm/validate-npm-package-name/tree/v6.0.0?tab=readme-ov-file#naming-rules
  if (!isNpmLegacyName(id)) {
    if (id.length > 214) {
      if (throws) {
        // Tested: validation returns false in non-throw mode
        // V8 coverage can't see both throw and return false paths in same test
        /* c8 ignore next 3 -- Throw path tested separately from return false path. */
        throw new PurlError(
          `npm "namespace" and "name" components can not collectively be more than 214 characters`,
        )
      }
      return false
    }
    if (loweredId !== id) {
      if (throws) {
        throw new PurlError(
          `npm "name" component can not contain capital letters`,
        )
      }
      return false
    }
    if (/[~'!()*]/.test(name)) {
      if (throws) {
        throw new PurlError(
          `npm "name" component can not contain special characters ("~'!()*")`,
        )
      }
      return false
    }
    if (isNpmBuiltinName(id)) {
      if (throws) {
        // Tested: validation returns false in non-throw mode
        // V8 coverage can't see both throw and return false paths in same test
        /* c8 ignore next 3 -- Throw path tested separately from return false path. */
        throw new PurlError(
          'npm "name" component can not be a core module name',
        )
      }
      return false
    }
  }
  return true
}
