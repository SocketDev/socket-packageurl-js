/**
 * @file Generic PURL registry existence check wrapper. Dispatches to
 *   type-specific existence checks based on package URL type.
 */

import { cargoExists } from './purl-types/cargo.mjs'
import { cocoapodsExists } from './purl-types/cocoapods.mjs'
import { packagistExists } from './purl-types/composer.mjs'
import { condaExists } from './purl-types/conda.mjs'
import { cpanExists } from './purl-types/cpan.mjs'
import { cranExists } from './purl-types/cran.mjs'
import { dockerExists } from './purl-types/docker.mjs'
import { gemExists } from './purl-types/gem.mjs'
import { golangExists } from './purl-types/golang.mjs'
import { hackageExists } from './purl-types/hackage.mjs'
import { hexExists } from './purl-types/hex.mjs'
import { mavenExists } from './purl-types/maven.mjs'
import { npmExists } from './purl-types/npm.mjs'
import { nugetExists } from './purl-types/nuget.mjs'
import { pubExists } from './purl-types/pub.mjs'
import { pypiExists } from './purl-types/pypi.mjs'

import type { PackageURL } from './package-url.mjs'
import type { ExistsOptions, ExistsResult } from './purl-types/npm.mjs'

/**
 * Check if a package exists in its registry.
 *
 * Generic wrapper that dispatches to type-specific existence checks based on
 * the package URL type. Queries the appropriate registry (`npm`, PyPI,
 * `crates.io`, `rubygems.org`, etc.) to verify package existence and retrieve
 * latest version.
 *
 * **Supported types:**
 *
 * - `npm` - Node.js packages from npmjs.org
 * - `pypi` - Python packages from pypi.org
 * - `cargo` - Rust crates from crates.io
 * - `gem` - Ruby gems from rubygems.org
 * - `maven` - Java packages from Maven Central
 * - `nuget` - .NET packages from nuget.org
 * - `golang` - Go modules from proxy.golang.org
 * - `composer` - PHP packages from packagist.org
 * - `cocoapods` - iOS/macOS pods from trunk.cocoapods.org
 * - `conda` - Conda packages from anaconda.org
 * - `docker` - Docker images from Docker Hub
 * - `pub` - Dart/Flutter packages from pub.dev
 * - `hex` - Elixir/Erlang packages from hex.pm
 * - `cpan` - Perl modules from metacpan.org
 * - `cran` - R packages from cran.r-universe.dev
 * - `hackage` - Haskell packages from hackage.haskell.org
 *
 * **Unsupported types:** Returns `{ exists: false, error: 'Unsupported type' }`
 *
 * **Caching:** Responses can be cached using a TTL cache to reduce registry
 * requests. Pass `{ cache }` option with a cache instance from
 * `createTtlCache()`.
 *
 * @example
 *   ;```typescript
 *   import { purlExists, PackageURL } from '@socketregistry/packageurl-js'
 *
 *   // Check npm package
 *   const npmPurl = PackageURL.fromString('pkg:npm/lodash@4.17.21')
 *   const result = await purlExists(npmPurl)
 *   // -> { exists: true, latestVersion: '4.17.21' }
 *
 *   // Check PyPI package
 *   const pypiPurl = PackageURL.fromString('pkg:pypi/requests@2.28.1')
 *   const result = await purlExists(pypiPurl)
 *   // -> { exists: true, latestVersion: '2.31.0' }
 *
 *   // With caching
 *   import { createTtlCache } from '@socketsecurity/lib/cache-with-ttl'
 *   const cache = createTtlCache({
 *     ttl: 5 * 60 * 1000,
 *     prefix: 'purl-registry',
 *   })
 *   const result = await purlExists(npmPurl, { cache })
 *
 *   // Unsupported type
 *   const mavenPurl = PackageURL.fromString('pkg:maven/org.apache/commons@1.0')
 *   const result = await purlExists(mavenPurl)
 *   // -> { exists: false, error: 'Unsupported type: maven' }
 *   ```
 *
 * @param purl - `PackageURL` instance or PURL string to check.
 * @param options - Optional configuration including `cache`
 *
 * @returns `Promise` resolving to existence result with latest version
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
    case 'maven':
      return mavenExists(name, namespace, version, options)
    case 'nuget':
      return nugetExists(name, version, options)
    case 'golang':
      return golangExists(name, namespace, version, options)
    case 'composer':
      return packagistExists(name, namespace, version, options)
    case 'cocoapods':
      return cocoapodsExists(name, version, options)
    case 'conda':
      return condaExists(name, version, namespace, options)
    case 'docker':
      return dockerExists(name, namespace, version, options)
    case 'pub':
      return pubExists(name, version, options)
    case 'hex':
      return hexExists(name, version, options)
    case 'cpan':
      return cpanExists(name, version, options)
    case 'cran':
      return cranExists(name, version, options)
    case 'hackage':
      return hackageExists(name, version, options)
    default:
      return {
        exists: false,
        error: `Unsupported type: ${type}`,
      }
  }
}
