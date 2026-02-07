/**
 * @fileoverview PURL comparison utilities.
 * Functions for comparing PackageURL instances.
 */

import type { PackageURL } from '../package-url.js'

/**
 * Compare two PackageURLs for equality.
 *
 * Two PURLs are considered equal if their canonical string representations match.
 * This comparison is case-sensitive after normalization.
 *
 * @param a - First PackageURL to compare
 * @param b - Second PackageURL to compare
 * @returns true if the PURLs are equal, false otherwise
 *
 * @example
 * ```typescript
 * const purl1 = parse('pkg:npm/lodash@4.17.21')
 * const purl2 = parse('pkg:npm/lodash@4.17.21')
 * const purl3 = parse('pkg:npm/lodash@4.17.20')
 *
 * equals(purl1, purl2) // -> true
 * equals(purl1, purl3) // -> false
 * ```
 */
export function equals(a: PackageURL, b: PackageURL): boolean {
  return a.toString() === b.toString()
}

/**
 * Compare two PackageURLs for sorting.
 *
 * Returns a number indicating sort order:
 * - Negative if `a` comes before `b`
 * - Zero if they are equal
 * - Positive if `a` comes after `b`
 *
 * Comparison is based on canonical string representation (lexicographic).
 *
 * @param a - First PackageURL to compare
 * @param b - Second PackageURL to compare
 * @returns -1, 0, or 1 for sort ordering
 *
 * @example
 * ```typescript
 * const purl1 = parse('pkg:npm/lodash@4.17.20')
 * const purl2 = parse('pkg:npm/lodash@4.17.21')
 *
 * compare(purl1, purl2) // -> -1 (purl1 < purl2)
 * compare(purl2, purl1) // -> 1  (purl2 > purl1)
 * compare(purl1, purl1) // -> 0  (equal)
 *
 * // Use with Array.sort
 * [purl2, purl1].sort(compare)
 * // -> [purl1, purl2]
 * ```
 */
export function compare(a: PackageURL, b: PackageURL): -1 | 0 | 1 {
  const aStr = a.toString()
  const bStr = b.toString()
  if (aStr < bStr) {
    return -1
  }
  if (aStr > bStr) {
    return 1
  }
  return 0
}
