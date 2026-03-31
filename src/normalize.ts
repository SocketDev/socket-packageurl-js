/**
 * @fileoverview Normalization functions for PURL components.
 * Handles path normalization, qualifier processing, and canonical form conversion.
 */
import { isObject } from './objects.js'
import {
  ObjectCreate,
  ObjectEntries,
  ObjectFreeze,
  ReflectApply,
  StringPrototypeCharCodeAt,
  StringPrototypeIndexOf,
  StringPrototypeSlice,
  StringPrototypeToLowerCase,
  StringPrototypeTrim,
  URLSearchParamsCtor,
} from './primordials.js'
import { isBlank } from './strings.js'

const EMPTY_ENTRIES: Iterable<[string, string]> = ObjectFreeze(
  [] as Array<[string, string]>,
)

import type { QualifiersObject } from './purl-component.js'

/**
 * Normalize package name by trimming whitespace.
 */
function normalizeName(rawName: unknown): string | undefined {
  return typeof rawName === 'string' ? StringPrototypeTrim(rawName) : undefined
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
  // stripped in the canonical form
  while (StringPrototypeCharCodeAt(pathname, start) === 47 /*'/'*/) {
    start += 1
  }
  let nextIndex = StringPrototypeIndexOf(pathname, '/', start)
  if (nextIndex === -1) {
    // No slashes found - return trimmed pathname
    return StringPrototypeSlice(pathname, start)
  }
  // Discard any empty string segments by collapsing repeated segment
  // separator slashes, i.e. '/'
  while (nextIndex !== -1) {
    const segment = StringPrototypeSlice(pathname, start, nextIndex)
    if (callback === undefined || callback(segment)) {
      // Add segment with separator if not first segment
      collapsed = collapsed + (collapsed.length === 0 ? '' : '/') + segment
    }
    // Skip to next segment, consuming multiple consecutive slashes
    start = nextIndex + 1
    while (StringPrototypeCharCodeAt(pathname, start) === 47) {
      start += 1
    }
    nextIndex = StringPrototypeIndexOf(pathname, '/', start)
  }
  // Handle last segment after final slash
  const lastSegment = StringPrototypeSlice(pathname, start)
  if (
    lastSegment.length !== 0 &&
    (callback === undefined || callback(lastSegment))
  ) {
    // Add segment with separator if not first segment
    collapsed = collapsed + (collapsed.length === 0 ? '' : '/') + lastSegment
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
  // Use for-of to work with entries iterators
  for (const { 0: key, 1: value } of qualifiersToEntries(rawQualifiers)) {
    // Only coerce primitive types — reject objects/functions that could
    // execute arbitrary code via toString() during coercion.
    const strValue =
      typeof value === 'string'
        ? value
        : typeof value === 'number' || typeof value === 'boolean'
          ? `${value}`
          : ''
    const trimmed = StringPrototypeTrim(strValue)
    // A key=value pair with an empty value is the same as no key/value
    // at all for this key
    if (trimmed.length === 0) {
      continue
    }
    if (qualifiers === undefined) {
      qualifiers = ObjectCreate(null) as Record<string, string>
    }
    // A key is case insensitive. The canonical form is lowercase
    qualifiers[StringPrototypeToLowerCase(key)] = trimmed
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
  // The type must NOT be percent-encoded
  // The type is case insensitive. The canonical form is lowercase
  return typeof rawType === 'string'
    ? StringPrototypeToLowerCase(StringPrototypeTrim(rawType))
    : undefined
}

/**
 * Normalize package version by trimming whitespace.
 */
function normalizeVersion(rawVersion: unknown): string | undefined {
  return typeof rawVersion === 'string'
    ? StringPrototypeTrim(rawVersion)
    : undefined
}

/**
 * Convert qualifiers to iterable entries.
 */
function qualifiersToEntries(
  rawQualifiers: unknown,
): Iterable<[string, string]> {
  if (isObject(rawQualifiers)) {
    // URLSearchParams instances have an "entries" method that returns an iterator
    const rawQualifiersObj = rawQualifiers as QualifiersObject | URLSearchParams
    const entriesProperty = (rawQualifiersObj as QualifiersObject)['entries']
    return typeof entriesProperty === 'function'
      ? (ReflectApply(entriesProperty, rawQualifiersObj, []) as Iterable<
          [string, string]
        >)
      : (ObjectEntries(rawQualifiers as Record<string, string>) as Iterable<
          [string, string]
        >)
  }
  return typeof rawQualifiers === 'string'
    ? new URLSearchParamsCtor(rawQualifiers).entries()
    : EMPTY_ENTRIES
}

/**
 * Filter invalid subpath segments.
 */
function subpathFilter(segment: string): boolean {
  // When percent-decoded, a segment
  //   - must not be any of '.' or '..'
  //   - must not be empty
  const { length } = segment
  if (length === 1 && StringPrototypeCharCodeAt(segment, 0) === 46 /*'.'*/) {
    return false
  }
  if (
    length === 2 &&
    StringPrototypeCharCodeAt(segment, 0) === 46 &&
    StringPrototypeCharCodeAt(segment, 1) === 46
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
