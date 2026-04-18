/**
 * @fileoverview PURL comparison utilities.
 * Functions for comparing PackageURL instances or PURL strings.
 */

import {
  MapCtor,
  RegExpPrototypeTest,
  StringPrototypeIncludes,
  StringPrototypeIndexOf,
  StringPrototypeReplace,
  StringPrototypeSlice,
  StringPrototypeStartsWith,
  StringPrototypeToLowerCase,
} from './primordials.js'

import type { PackageURL } from './package-url.js'

export type PurlInput = PackageURL | string

// Lazy reference to PackageURL, set by package-url.ts at module load time
// to avoid circular import issues.
let _PackageURL: typeof PackageURL | undefined

/** @internal Register the PackageURL class for string parsing in compare functions. */
export function _registerPackageURL(ctor: typeof PackageURL): void {
  _PackageURL = ctor
}

function toCanonicalString(input: PurlInput): string {
  if (typeof input === 'string') {
    /* v8 ignore start -- PackageURL is always registered at module load time. */
    if (!_PackageURL) {
      throw new Error(
        'PackageURL not registered. Import PackageURL before using string comparison.',
      )
    }
    /* v8 ignore stop */
    return _PackageURL.fromString(input).toString()
  }
  return input.toString()
}

/**
 * Cache for compiled wildcard regexes to avoid recompilation on repeated calls.
 * Bounded to 1024 entries with LRU eviction (same strategy as flyweight cache).
 */
const wildcardRegexCache = new MapCtor<string, RegExp>()
const WILDCARD_CACHE_MAX = 1024

/**
 * Simple wildcard matcher for PURL components.
 * Supports * (match any chars), ? (match single char), ** (match anything including empty).
 * Designed for version strings and package names, not file paths.
 */
const MAX_PATTERN_LENGTH = 4096

function matchWildcard(pattern: string, value: string): boolean {
  // Reject excessively long patterns to prevent regex compilation DoS
  if (pattern.length > MAX_PATTERN_LENGTH) {
    return false
  }
  let regex = wildcardRegexCache.get(pattern)
  if (regex === undefined) {
    // Convert glob pattern to regex
    // Escape regex special chars except * and ?
    const regexPattern = StringPrototypeReplace(
      StringPrototypeReplace(
        StringPrototypeReplace(pattern, /[.+^${}()|[\]\\]/g, '\\$&' as any),
        /\*/g,
        '.*' as any,
      ),
      /\?/g,
      '.' as any,
    )

    // Collapse consecutive .* groups to prevent polynomial backtracking (ReDoS)
    regex = new RegExp(
      `^${StringPrototypeReplace(regexPattern, /(\.\*)+/g, '.*' as any)}$`,
    )
    if (wildcardRegexCache.size >= WILDCARD_CACHE_MAX) {
      // Evict oldest entry (Map iteration order is insertion order)
      const oldest = wildcardRegexCache.keys().next().value
      if (oldest !== undefined) {
        wildcardRegexCache.delete(oldest)
      }
    }
    wildcardRegexCache.set(pattern, regex)
  } else {
    // Promote to most-recently-used by re-inserting.
    wildcardRegexCache.delete(pattern)
    wildcardRegexCache.set(pattern, regex)
  }
  return RegExpPrototypeTest(regex, value)
}

/**
 * Match a single component value against a pattern.
 * Handles wildcard matching for individual PURL components.
 */
function matchComponent(
  patternValue: string | null | undefined,
  actualValue: string | null | undefined,
  matcher?: (_value: string) => boolean,
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
  if (matcher) {
    return matcher(actualValue)
  }

  // Check if pattern contains wildcards (when no pre-compiled matcher)
  if (
    StringPrototypeIncludes(patternValue, '*') ||
    StringPrototypeIncludes(patternValue, '?')
  ) {
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
 * Accepts both PackageURL instances and PURL strings. Strings are parsed and
 * normalized before comparison.
 *
 * @param a - First PackageURL or PURL string to compare
 * @param b - Second PackageURL or PURL string to compare
 * @returns true if the PURLs are equal, false otherwise
 *
 * @example
 * ```typescript
 * const purl1 = PackageURL.fromString('pkg:npm/lodash@4.17.21')
 * const purl2 = PackageURL.fromString('pkg:npm/lodash@4.17.21')
 *
 * equals(purl1, purl2) // -> true
 * equals('pkg:npm/lodash@4.17.21', 'pkg:NPM/lodash@4.17.21') // -> true
 * equals(purl1, 'pkg:npm/lodash@4.17.20') // -> false
 * ```
 */
export function equals(a: PurlInput, b: PurlInput): boolean {
  return toCanonicalString(a) === toCanonicalString(b)
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
 * Accepts both PackageURL instances and PURL strings. Strings are parsed and
 * normalized before comparison.
 *
 * @param a - First PackageURL or PURL string to compare
 * @param b - Second PackageURL or PURL string to compare
 * @returns -1, 0, or 1 for sort ordering
 *
 * @example
 * ```typescript
 * compare('pkg:npm/aaa', 'pkg:npm/bbb') // -> -1
 * compare('pkg:npm/bbb', 'pkg:npm/aaa') // -> 1
 *
 * // Use with Array.sort
 * ['pkg:npm/bbb', 'pkg:npm/aaa'].sort(compare)
 * // -> ['pkg:npm/aaa', 'pkg:npm/bbb']
 * ```
 */
export function compare(a: PurlInput, b: PurlInput): -1 | 0 | 1 {
  const aStr = toCanonicalString(a)
  const bStr = toCanonicalString(b)
  if (aStr < bStr) {
    return -1
  }
  if (aStr > bStr) {
    return 1
  }
  return 0
}

type ParsedPattern = {
  typePattern: string
  namespacePattern: string | undefined
  namePattern: string
  versionPattern: string | undefined
}

/**
 * Parse a PURL pattern string into its individual components.
 * Strips the `pkg:` prefix, extracts type/namespace/name/version,
 * handles scoped `@` prefixes, and applies type-specific normalization
 * (npm lowercase, pypi underscore-to-hyphen).
 *
 * Returns undefined if the pattern is not a valid PURL pattern shape.
 */
function parsePattern(pattern: string): ParsedPattern | undefined {
  if (!StringPrototypeStartsWith(pattern, 'pkg:')) {
    return undefined
  }

  // Remove 'pkg:' prefix
  const patternWithoutScheme = StringPrototypeSlice(pattern, 4)

  // Extract type
  const typeEndIndex = StringPrototypeIndexOf(patternWithoutScheme, '/')
  if (typeEndIndex === -1) {
    return undefined
  }
  let typePattern = StringPrototypeSlice(patternWithoutScheme, 0, typeEndIndex)

  // Extract remaining parts
  const remaining = StringPrototypeSlice(patternWithoutScheme, typeEndIndex + 1)

  // Parse namespace and name
  // Format: [namespace/]name[@version][?qualifiers][#subpath]
  // Namespace is optional and ends at the first '/'
  let namespacePattern: string | undefined
  let namePattern: string
  let versionPattern: string | undefined

  // Check if there's a namespace (indicated by presence of '/')
  const firstSlashIndex = StringPrototypeIndexOf(remaining, '/')
  let nameAndVersion: string

  if (firstSlashIndex !== -1) {
    // Has namespace
    namespacePattern = StringPrototypeSlice(remaining, 0, firstSlashIndex)
    nameAndVersion = StringPrototypeSlice(remaining, firstSlashIndex + 1)
  } else {
    // No namespace
    nameAndVersion = remaining
  }

  // Extract version from name (version starts with '@')
  // For scoped packages without namespace (e.g., '@foo' as name), skip first '@'
  const versionSeparatorIndex = StringPrototypeStartsWith(nameAndVersion, '@')
    ? StringPrototypeIndexOf(nameAndVersion, '@', 1)
    : StringPrototypeIndexOf(nameAndVersion, '@')

  if (versionSeparatorIndex !== -1) {
    namePattern = StringPrototypeSlice(nameAndVersion, 0, versionSeparatorIndex)
    // Version is everything after @ (qualifiers/subpath not supported in patterns v1)
    versionPattern = StringPrototypeSlice(
      nameAndVersion,
      versionSeparatorIndex + 1,
    )
  } else {
    namePattern = nameAndVersion
  }

  // Apply type-specific normalization to pattern components
  // Types are case-insensitive, so normalize to lowercase
  typePattern = StringPrototypeToLowerCase(typePattern)

  // For npm: lowercase namespace and name (ignoring legacy names for simplicity)
  if (typePattern === 'npm') {
    if (namespacePattern) {
      namespacePattern = StringPrototypeToLowerCase(namespacePattern)
    }
    namePattern = StringPrototypeToLowerCase(namePattern)
  }

  // For pypi: lowercase name and replace underscores with hyphens
  if (typePattern === 'pypi') {
    namePattern = StringPrototypeReplace(
      StringPrototypeToLowerCase(namePattern),
      /_/g,
      '-' as any,
    )
  }

  return { typePattern, namespacePattern, namePattern, versionPattern }
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
  const parsed = parsePattern(pattern)
  if (!parsed) {
    return false
  }
  const { typePattern, namespacePattern, namePattern, versionPattern } = parsed

  // Match each component (always use component matching to properly ignore qualifiers/subpath)
  return (
    matchComponent(typePattern, purl.type) &&
    matchComponent(namespacePattern, purl.namespace) &&
    matchComponent(namePattern, purl.name) &&
    matchComponent(versionPattern, purl.version)
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
  const parsed = parsePattern(pattern)
  if (!parsed) {
    return () => false
  }
  const { typePattern, namespacePattern, namePattern, versionPattern } = parsed

  // Pre-compile wildcard matchers for components with wildcards
  const typeHasWildcard =
    typePattern &&
    (StringPrototypeIncludes(typePattern, '*') ||
      StringPrototypeIncludes(typePattern, '?'))
  const typeMatcher = typeHasWildcard
    ? (value: string) => matchWildcard(typePattern, value)
    : undefined

  const namespaceHasWildcard =
    namespacePattern &&
    (StringPrototypeIncludes(namespacePattern, '*') ||
      StringPrototypeIncludes(namespacePattern, '?'))
  const namespaceMatcher =
    namespaceHasWildcard && namespacePattern
      ? (value: string) => matchWildcard(namespacePattern, value)
      : undefined

  const nameHasWildcard =
    namePattern &&
    (StringPrototypeIncludes(namePattern, '*') ||
      StringPrototypeIncludes(namePattern, '?'))
  const nameMatcher = nameHasWildcard
    ? (value: string) => matchWildcard(namePattern, value)
    : undefined

  const versionHasWildcard =
    versionPattern &&
    (StringPrototypeIncludes(versionPattern, '*') ||
      StringPrototypeIncludes(versionPattern, '?'))
  const versionMatcher =
    versionHasWildcard && versionPattern
      ? (value: string) => matchWildcard(versionPattern, value)
      : undefined

  // Return optimized matcher function with pre-compiled matchers
  return (_purl: PackageURL): boolean => {
    return (
      matchComponent(typePattern, _purl.type, typeMatcher) &&
      matchComponent(namespacePattern, _purl.namespace, namespaceMatcher) &&
      matchComponent(namePattern, _purl.name, nameMatcher) &&
      matchComponent(versionPattern, _purl.version, versionMatcher)
    )
  }
}
