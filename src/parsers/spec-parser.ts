/**
 * @fileoverview Generic package specifier parser.
 * Delegates to type-specific parsers based on ecosystem type.
 */

import type { PackageURL } from '../package-url.js'
import { fromNpm } from './npm.js'

/**
 * Create PackageURL from ecosystem-specific package specifier.
 *
 * This is a convenience wrapper that delegates to type-specific parsers.
 * Each ecosystem has its own specifier format and parsing rules.
 *
 * **Supported types:**
 * - `npm`: npm package specifiers (e.g., 'lodash@4.17.21', '@babel/core@^7.0.0')
 *
 * @param type - Package ecosystem type (e.g., 'npm', 'pypi', 'maven')
 * @param specifier - Ecosystem-specific package specifier string
 * @returns PackageURL instance for the package
 * @throws {Error} If type is not supported or specifier is invalid
 *
 * @example
 * ```typescript
 * // npm packages
 * fromSpec('npm', 'lodash@4.17.21')
 * // -> pkg:npm/lodash@4.17.21
 *
 * fromSpec('npm', '@babel/core@^7.0.0')
 * // -> pkg:npm/%40babel/core@7.0.0
 * ```
 */
export function fromSpec(type: string, specifier: unknown): PackageURL {
  switch (type) {
    case 'npm':
      return fromNpm(specifier)
    default:
      throw new Error(
        `Unsupported package type: ${type}. Currently supported: npm`,
      )
  }
}
