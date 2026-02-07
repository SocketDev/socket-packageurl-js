/**
 * @fileoverview PURL string parsing.
 * Converts PURL strings to PackageURL instances.
 */

import { PackageURL } from '../package-url.js'

/**
 * Parse PURL string into PackageURL instance.
 *
 * Parses a Package URL string according to the PURL specification.
 * Supports optional "pkg:" prefix - will auto-prepend if missing for valid PURL-like strings.
 *
 * @param purlStr - PURL string to parse (e.g., 'pkg:npm/lodash@4.17.21' or 'npm/lodash@4.17.21')
 * @returns PackageURL instance
 * @throws {Error} If string is not a valid PURL
 *
 * @example
 * ```typescript
 * // With pkg: prefix
 * parse('pkg:npm/lodash@4.17.21')
 * // -> PackageURL { type: 'npm', name: 'lodash', version: '4.17.21' }
 *
 * // Without pkg: prefix (auto-prepended)
 * parse('npm/lodash@4.17.21')
 * // -> PackageURL { type: 'npm', name: 'lodash', version: '4.17.21' }
 *
 * // With namespace
 * parse('pkg:npm/@babel/core@7.0.0')
 * // -> PackageURL { type: 'npm', namespace: '@babel', name: 'core', version: '7.0.0' }
 * ```
 */
export function parse(purlStr: unknown): PackageURL {
  return new PackageURL(
    ...(PackageURL.parseString(purlStr) as [
      unknown,
      unknown,
      unknown,
      unknown,
      unknown,
      unknown,
    ]),
  )
}
