/**
 * @fileoverview npm package specifier parser.
 * Converts npm package specifiers to PackageURL instances.
 */

import { PackageURL } from '../package-url.js'
import { isBlank } from '../strings.js'

/**
 * Create PackageURL from npm package specifier.
 *
 * Parses npm package specifiers and converts them to PackageURL format.
 * Handles scoped packages, version ranges, and normalizes version strings.
 *
 * **Supported formats:**
 * - Basic packages: `lodash`, `lodash@4.17.21`
 * - Scoped packages: `@babel/core`, `@babel/core@7.0.0`
 * - Version ranges: `^4.17.21`, `~1.2.3`, `>=1.0.0` (prefixes stripped)
 * - Dist-tags: `latest`, `next`, `beta` (passed through as version)
 *
 * **Not supported:**
 * - Git URLs: `git+https://...` (use PackageURL constructor directly)
 * - File paths: `file:../package.tgz`
 * - GitHub shortcuts: `user/repo#branch`
 * - Aliases: `npm:package@version`
 *
 * **Note:** Dist-tags like `latest` are mutable and should be resolved to
 * concrete versions for reproducible builds. This method passes them through
 * as-is for convenience.
 *
 * @param specifier - npm package specifier (e.g., 'lodash@4.17.21', '@babel/core@^7.0.0')
 * @returns PackageURL instance for the npm package
 * @throws {Error} If specifier is not a string or is empty
 *
 * @example
 * ```typescript
 * // Basic packages
 * fromNpm('lodash@4.17.21')
 * // -> pkg:npm/lodash@4.17.21
 *
 * // Scoped packages
 * fromNpm('@babel/core@^7.0.0')
 * // -> pkg:npm/%40babel/core@7.0.0
 *
 * // Dist-tags (passed through)
 * fromNpm('react@latest')
 * // -> pkg:npm/react@latest
 *
 * // No version
 * fromNpm('express')
 * // -> pkg:npm/express
 * ```
 */
export function fromNpm(specifier: unknown): PackageURL {
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

  return new PackageURL('npm', namespace, name, version, undefined, undefined)
}
