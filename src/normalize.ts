/**
 * @fileoverview Normalization functions for PURL components.
 * Handles path normalization, qualifier processing, and canonical form conversion.
 */
import { isObject } from './objects.js'
import { isBlank } from './strings.js'

import type { QualifiersObject } from './purl-component.js'

/**
 * Normalize package name by trimming whitespace.
 */
function normalizeName(rawName: unknown): string | undefined {
  return typeof rawName === 'string' ? rawName.trim() : undefined
}

/**
 * Normalize package namespace by trimming and collapsing path separators.
 */
function normalizeNamespace(rawNamespace: unknown): string | undefined {
  return typeof rawNamespace === 'string'
    ? normalizePurlPath(rawNamespace)
    : undefined
}

/**
 * Normalize purl path component by collapsing separators and filtering segments.
 */
function normalizePurlPath(
  pathname: string,
  options?: { filter?: ((_segment: string) => boolean) | undefined },
): string {
  const { filter: callback } = options ?? {}
  let collapsed = ''
  let start = 0
  // Leading and trailing slashes, i.e. '/', are not significant and should be
  // stripped in the canonical form.
  while (pathname.charCodeAt(start) === 47 /*'/'*/) {
    start += 1
  }
  let nextIndex = pathname.indexOf('/', start)
  if (nextIndex === -1) {
    // No slashes found - return trimmed pathname.
    return pathname.slice(start)
  }
  // Discard any empty string segments by collapsing repeated segment
  // separator slashes, i.e. '/'.
  while (nextIndex !== -1) {
    const segment = pathname.slice(start, nextIndex)
    if (callback === undefined || callback(segment)) {
      // Add segment with separator if not first segment.
      collapsed = collapsed + (collapsed.length === 0 ? '' : '/') + segment
    }
    // Skip to next segment, consuming multiple consecutive slashes.
    start = nextIndex + 1
    while (pathname.charCodeAt(start) === 47) {
      start += 1
    }
    nextIndex = pathname.indexOf('/', start)
  }
  // Handle last segment after final slash.
  const lastSegment = pathname.slice(start)
  if (
    lastSegment.length !== 0 &&
    (callback === undefined || callback(lastSegment))
  ) {
    collapsed = collapsed + '/' + lastSegment
  }
  return collapsed
}

/**
 * Normalize qualifiers by trimming values and lowercasing keys.
 */
function normalizeQualifiers(
  rawQualifiers: unknown,
): Record<string, string> | undefined {
  let qualifiers: Record<string, string> | undefined
  // Use for-of to work with entries iterators.
  for (const { 0: key, 1: value } of qualifiersToEntries(rawQualifiers)) {
    const strValue = typeof value === 'string' ? value : String(value)
    const trimmed = strValue.trim()
    // A key=value pair with an empty value is the same as no key/value
    // at all for this key.
    if (trimmed.length === 0) {
      continue
    }
    if (qualifiers === undefined) {
      qualifiers = Object.create(null) as Record<string, string>
    }
    // A key is case insensitive. The canonical form is lowercase.
    qualifiers[key.toLowerCase()] = trimmed
  }
  return qualifiers
}

/**
 * Normalize subpath by filtering invalid segments.
 */
function normalizeSubpath(rawSubpath: unknown): string | undefined {
  return typeof rawSubpath === 'string'
    ? normalizePurlPath(rawSubpath, { filter: subpathFilter })
    : undefined
}

/**
 * Normalize package type to lowercase.
 */
function normalizeType(rawType: unknown): string | undefined {
  // The type must NOT be percent-encoded.
  // The type is case insensitive. The canonical form is lowercase.
  return typeof rawType === 'string' ? rawType.trim().toLowerCase() : undefined
}

/**
 * Normalize package version by trimming whitespace.
 */
function normalizeVersion(rawVersion: unknown): string | undefined {
  return typeof rawVersion === 'string' ? rawVersion.trim() : undefined
}

// IMPORTANT: Do not use destructuring here - use direct assignment instead.
// tsgo has a bug that incorrectly transpiles destructured exports, resulting in
// `exports.ReflectApply = void 0;` which causes runtime errors.
// See: https://github.com/SocketDev/socket-packageurl-js/issues/3
const ReflectApply = Reflect.apply

/**
 * Convert qualifiers to iterable entries.
 */
function qualifiersToEntries(
  rawQualifiers: unknown,
): Iterable<[string, string]> {
  if (isObject(rawQualifiers)) {
    // URLSearchParams instances have an "entries" method that returns an iterator.
    const rawQualifiersObj = rawQualifiers as QualifiersObject | URLSearchParams
    const entriesProperty = (rawQualifiersObj as QualifiersObject)['entries']
    return typeof entriesProperty === 'function'
      ? (ReflectApply(entriesProperty, rawQualifiersObj, []) as Iterable<
          [string, string]
        >)
      : (Object.entries(rawQualifiers as Record<string, string>) as Iterable<
          [string, string]
        >)
  }
  return typeof rawQualifiers === 'string'
    ? new URLSearchParams(rawQualifiers).entries()
    : Object.entries({})
}

/**
 * Filter invalid subpath segments.
 */
function subpathFilter(segment: string): boolean {
  // When percent-decoded, a segment
  //   - must not be any of '.' or '..'
  //   - must not be empty
  const { length } = segment
  if (length === 1 && segment.charCodeAt(0) === 46 /*'.'*/) {
    return false
  }
  if (
    length === 2 &&
    segment.charCodeAt(0) === 46 &&
    segment.charCodeAt(1) === 46
  ) {
    return false
  }
  return !isBlank(segment)
}

export {
  normalizeName,
  normalizeNamespace,
  normalizePurlPath,
  normalizeQualifiers,
  normalizeSubpath,
  normalizeType,
  normalizeVersion,
}
