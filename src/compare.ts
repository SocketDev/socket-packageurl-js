/**
 * @fileoverview PURL comparison utilities.
 * Functions for comparing PackageURL instances.
 */

import type { PackageURL } from './package-url.js'

/**
 * Simple wildcard matcher for PURL components.
 * Supports * (match any chars), ? (match single char), ** (match anything including empty).
 * Designed for version strings and package names, not file paths.
 */
function matchWildcard(pattern: string, value: string): boolean {
  // Convert glob pattern to regex
  // Escape regex special chars except * and ?
  let regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')

  // Anchor to start and end
  regexPattern = `^${regexPattern}$`

  const regex = new RegExp(regexPattern)
  return regex.test(value)
}

/**
 * Match a single component value against a pattern.
 * Handles wildcard matching for individual PURL components.
 */
function matchComponent(
  patternValue: string | null | undefined,
  actualValue: string | null | undefined,
  matcher: ((_value: string) => boolean) | null = null,
): boolean {
  // Handle ** (match any value including empty)
  if (patternValue === '**') {
    return true
  }

  // If pattern has no value, actual must also have no value
  if (
    patternValue === null ||
    patternValue === undefined ||
    patternValue === ''
  ) {
    return (
      actualValue === null || actualValue === undefined || actualValue === ''
    )
  }

  // If actual has no value but pattern expects one, no match
  if (actualValue === null || actualValue === undefined || actualValue === '') {
    return false
  }

  // Use pre-compiled matcher if provided
  if (matcher !== null) {
    return matcher(actualValue)
  }

  // Check if pattern contains wildcards (when no pre-compiled matcher)
  if (patternValue.includes('*') || patternValue.includes('?')) {
    return matchWildcard(patternValue, actualValue)
  }

  // Literal match
  return patternValue === actualValue
}

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

/**
 * Check if a PackageURL matches a pattern with wildcards.
 *
 * Supports glob-style wildcards:
 * - asterisk matches any sequence of characters within a component
 * - double asterisk matches any value including empty (for optional components)
 * - question mark matches single character
 *
 * Pattern matching is performed on normalized PURLs (after type-specific
 * normalization). Each component is matched independently.
 *
 * @param pattern - PURL string with wildcards
 * @param purl - PackageURL instance to test
 * @returns true if purl matches the pattern
 *
 * @example
 * Wildcard in name: matches('pkg:npm/lodash-star', purl)
 * Wildcard in namespace: matches('pkg:npm/@babel/star', purl)
 * Wildcard in version: matches('pkg:npm/react@18.star', purl)
 * Match any type: matches('pkg:star/lodash', purl)
 * Optional version: matches('pkg:npm/lodash@star-star', purl)
 *
 * See test/pattern-matching.test.mts for comprehensive examples.
 */
export function matches(pattern: string, purl: PackageURL): boolean {
  // Parse pattern string manually to extract components (without validation)
  // Pattern format: pkg:type/namespace/name@version?qualifiers#subpath
  if (!pattern.startsWith('pkg:')) {
    return false
  }

  // Remove 'pkg:' prefix
  const patternWithoutScheme = pattern.slice(4)

  // Extract type
  const typeEndIndex = patternWithoutScheme.indexOf('/')
  if (typeEndIndex === -1) {
    return false
  }
  let patternType = patternWithoutScheme.slice(0, typeEndIndex)

  // Extract remaining parts
  const remaining = patternWithoutScheme.slice(typeEndIndex + 1)

  // Parse namespace and name
  // Format: [namespace/]name[@version][?qualifiers][#subpath]
  // Namespace is optional and ends at the first '/'
  let patternNamespace: string | undefined
  let patternName: string
  let patternVersion: string | undefined

  // Check if there's a namespace (indicated by presence of '/')
  const firstSlashIndex = remaining.indexOf('/')
  let nameAndVersion: string

  if (firstSlashIndex !== -1) {
    // Has namespace
    patternNamespace = remaining.slice(0, firstSlashIndex)
    nameAndVersion = remaining.slice(firstSlashIndex + 1)
  } else {
    // No namespace
    nameAndVersion = remaining
  }

  // Extract version from name (version starts with '@')
  // For scoped packages without namespace (e.g., '@foo' as name), skip first '@'
  const versionSeparatorIndex = nameAndVersion.startsWith('@')
    ? nameAndVersion.indexOf('@', 1)
    : nameAndVersion.indexOf('@')

  if (versionSeparatorIndex !== -1) {
    patternName = nameAndVersion.slice(0, versionSeparatorIndex)
    // Version is everything after @ (qualifiers/subpath not supported in patterns v1)
    patternVersion = nameAndVersion.slice(versionSeparatorIndex + 1)
  } else {
    patternName = nameAndVersion
  }

  // Apply type-specific normalization to pattern components
  // Types are case-insensitive, so normalize to lowercase
  patternType = patternType.toLowerCase()

  // For npm: lowercase namespace and name (ignoring legacy names for simplicity)
  if (patternType === 'npm') {
    if (patternNamespace) {
      patternNamespace = patternNamespace.toLowerCase()
    }
    patternName = patternName.toLowerCase()
  }

  // For pypi: lowercase name and replace underscores with hyphens
  if (patternType === 'pypi') {
    patternName = patternName.toLowerCase().replace(/_/g, '-')
  }

  // Match each component (always use component matching to properly ignore qualifiers/subpath)
  return (
    matchComponent(patternType, purl.type) &&
    matchComponent(patternNamespace, purl.namespace) &&
    matchComponent(patternName, purl.name) &&
    matchComponent(patternVersion, purl.version)
  )
}

/**
 * Create a reusable matcher function from a pattern.
 * More efficient for testing multiple PURLs against the same pattern.
 *
 * The returned function can be used with Array methods like filter(),
 * some(), and every() for efficient batch matching operations.
 *
 * @param pattern - PURL pattern string with wildcards
 * @returns Function that tests PURLs against the pattern
 *
 * @example
 * const isBabel = createMatcher('pkg:npm/@babel/star')
 * packages.filter(isBabel)
 *
 * See test/pattern-matching.test.mts for comprehensive examples.
 */
export function createMatcher(pattern: string): (_purl: PackageURL) => boolean {
  // Parse pattern string manually (without validation)
  if (!pattern.startsWith('pkg:')) {
    return () => false
  }

  const patternWithoutScheme = pattern.slice(4)
  const typeEndIndex = patternWithoutScheme.indexOf('/')
  if (typeEndIndex === -1) {
    return () => false
  }

  let patternType = patternWithoutScheme.slice(0, typeEndIndex)
  const remaining = patternWithoutScheme.slice(typeEndIndex + 1)

  // Parse namespace and name
  // Format: [namespace/]name[@version][?qualifiers][#subpath]
  // Namespace is optional and ends at the first '/'
  let patternNamespace: string | undefined
  let patternName: string
  let patternVersion: string | undefined

  // Check if there's a namespace (indicated by presence of '/')
  const firstSlashIndex = remaining.indexOf('/')
  let nameAndVersion: string

  if (firstSlashIndex !== -1) {
    // Has namespace
    patternNamespace = remaining.slice(0, firstSlashIndex)
    nameAndVersion = remaining.slice(firstSlashIndex + 1)
  } else {
    // No namespace
    nameAndVersion = remaining
  }

  // Extract version from name (version starts with '@')
  // For scoped packages without namespace (e.g., '@foo' as name), skip first '@'
  const versionSeparatorIndex = nameAndVersion.startsWith('@')
    ? nameAndVersion.indexOf('@', 1)
    : nameAndVersion.indexOf('@')

  if (versionSeparatorIndex !== -1) {
    patternName = nameAndVersion.slice(0, versionSeparatorIndex)
    // Version is everything after @ (qualifiers/subpath not supported in patterns v1)
    patternVersion = nameAndVersion.slice(versionSeparatorIndex + 1)
  } else {
    patternName = nameAndVersion
  }

  // Apply type-specific normalization to pattern components
  // Types are case-insensitive, so normalize to lowercase
  patternType = patternType.toLowerCase()

  // For npm: lowercase namespace and name (ignoring legacy names for simplicity)
  if (patternType === 'npm') {
    if (patternNamespace) {
      patternNamespace = patternNamespace.toLowerCase()
    }
    patternName = patternName.toLowerCase()
  }

  // For pypi: lowercase name and replace underscores with hyphens
  if (patternType === 'pypi') {
    patternName = patternName.toLowerCase().replace(/_/g, '-')
  }

  // Pre-compile wildcard matchers for components with wildcards
  const typeHasWildcard =
    patternType && (patternType.includes('*') || patternType.includes('?'))
  const typeMatcher = typeHasWildcard
    ? (value: string) => matchWildcard(patternType, value)
    : null

  const namespaceHasWildcard =
    patternNamespace &&
    (patternNamespace.includes('*') || patternNamespace.includes('?'))
  const namespaceMatcher =
    namespaceHasWildcard && patternNamespace
      ? (value: string) => matchWildcard(patternNamespace, value)
      : null

  const nameHasWildcard =
    patternName && (patternName.includes('*') || patternName.includes('?'))
  const nameMatcher = nameHasWildcard
    ? (value: string) => matchWildcard(patternName, value)
    : null

  const versionHasWildcard =
    patternVersion &&
    (patternVersion.includes('*') || patternVersion.includes('?'))
  const versionMatcher =
    versionHasWildcard && patternVersion
      ? (value: string) => matchWildcard(patternVersion, value)
      : null

  // Return optimized matcher function with pre-compiled matchers
  return (_purl: PackageURL): boolean => {
    return (
      matchComponent(patternType, _purl.type, typeMatcher) &&
      matchComponent(patternNamespace, _purl.namespace, namespaceMatcher) &&
      matchComponent(patternName, _purl.name, nameMatcher) &&
      matchComponent(patternVersion, _purl.version, versionMatcher)
    )
  }
}
