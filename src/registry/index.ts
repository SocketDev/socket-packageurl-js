/**
 * @fileoverview Registry existence checks for Package URLs.
 * Provides modular functions to verify package existence across different registries.
 */

import { cargoExists } from './cargo.js'
import { gemExists } from './gem.js'
import { npmExists } from './npm.js'
import { pypiExists } from './pypi.js'

import type { ExistsResult, ExistsOptions } from './npm.js'
import type { PackageURL } from '../package-url.js'

// Re-export all specific existence checks
export { cargoExists } from './cargo.js'
export { gemExists } from './gem.js'
export { npmExists } from './npm.js'
export { pypiExists } from './pypi.js'
export type { ExistsResult, ExistsOptions } from './npm.js'

/**
 * Check if a package exists in its registry.
 *
 * Generic wrapper that dispatches to type-specific existence checks based on
 * the package URL type. Queries the appropriate registry (npm, PyPI, crates.io,
 * rubygems.org, etc.) to verify package existence and retrieve latest version.
 *
 * **Supported types:**
 * - `npm` - Node.js packages from npmjs.org
 * - `pypi` - Python packages from pypi.org
 * - `cargo` - Rust crates from crates.io
 * - `gem` - Ruby gems from rubygems.org
 *
 * **Unsupported types:** Returns `{ exists: false, error: 'Unsupported type' }`
 *
 * **Caching:** Responses can be cached using a TTL cache to reduce registry
 * requests. Pass `{ cache }` option with a cache instance from `createTtlCache()`.
 *
 * @param purl - PackageURL instance or PURL string to check
 * @param options - Optional configuration including cache
 * @returns Promise resolving to existence result with latest version
 *
 * @example
 * ```typescript
 * import { purlExists, PackageURL } from '@socketregistry/packageurl-js'
 *
 * // Check npm package
 * const npmPurl = PackageURL.fromString('pkg:npm/lodash@4.17.21')
 * const result = await purlExists(npmPurl)
 * // -> { exists: true, latestVersion: '4.17.21' }
 *
 * // Check PyPI package
 * const pypiPurl = PackageURL.fromString('pkg:pypi/requests@2.28.1')
 * const result = await purlExists(pypiPurl)
 * // -> { exists: true, latestVersion: '2.31.0' }
 *
 * // With caching
 * import { createTtlCache } from '@socketsecurity/lib/cache-with-ttl'
 * const cache = createTtlCache({ ttl: 5 * 60 * 1000, prefix: 'purl-registry' })
 * const result = await purlExists(npmPurl, { cache })
 *
 * // Unsupported type
 * const mavenPurl = PackageURL.fromString('pkg:maven/org.apache/commons@1.0')
 * const result = await purlExists(mavenPurl)
 * // -> { exists: false, error: 'Unsupported type: maven' }
 * ```
 */
export async function purlExists(
  purl: PackageURL,
  options?: ExistsOptions,
): Promise<ExistsResult> {
  const { name, namespace, type, version } = purl

  if (!type) {
    return {
      exists: false,
      error: 'Package type is required',
    }
  }

  if (!name) {
    return {
      exists: false,
      error: 'Package name is required',
    }
  }

  switch (type) {
    case 'npm':
      return npmExists(name, namespace, version, options)
    case 'pypi':
      return pypiExists(name, version, options)
    case 'cargo':
      return cargoExists(name, version, options)
    case 'gem':
      return gemExists(name, version, options)
    default:
      return {
        exists: false,
        error: `Unsupported type: ${type}`,
      }
  }
}
