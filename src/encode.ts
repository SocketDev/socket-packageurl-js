/**
 * @fileoverview URL encoding functions for PURL components.
 * Provides special handling for names, namespaces, versions, qualifiers, and subpaths.
 */
import { isObject } from './objects.js'
import {
  ArrayPrototypeToSorted,
  ObjectKeys,
  StringPrototypeReplaceAll,
  StringPrototypeSlice,
  URLSearchParamsCtor,
  encodeComponent,
} from './primordials.js'
import { isNonEmptyString } from './strings.js'

// Module-private reusable URLSearchParams for encodeQualifierParam. Kept
// private here so mutation side-effects can't leak to other modules.
const REUSED_SEARCH_PARAMS = new URLSearchParamsCtor()
const REUSED_SEARCH_PARAMS_KEY = '_'
// '_='.length
const REUSED_SEARCH_PARAMS_OFFSET = 2

/**
 * Encode package name component for URL.
 */
function encodeName(name: unknown): string {
  return isNonEmptyString(name)
    ? StringPrototypeReplaceAll(encodeComponent(name), '%3A', ':')
    : ''
}

/**
 * Encode package namespace component for URL.
 */
function encodeNamespace(namespace: unknown): string {
  return isNonEmptyString(namespace)
    ? StringPrototypeReplaceAll(
        StringPrototypeReplaceAll(encodeComponent(namespace), '%3A', ':'),
        '%2F',
        '/',
      )
    : ''
}

/**
 * Encode qualifier parameter key or value.
 */
function encodeQualifierParam(param: unknown): string {
  if (isNonEmptyString(param)) {
    const value = prepareValueForSearchParams(param)
    // Use URLSearchParams#set to preserve plus signs
    // https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams#preserving_plus_signs
    // Reuse shared instance — JS is single-threaded so no concurrent mutation issues
    REUSED_SEARCH_PARAMS.set(REUSED_SEARCH_PARAMS_KEY, value)
    // Param key and value are encoded with `percentEncodeSet` of
    // 'application/x-www-form-urlencoded' and `spaceAsPlus` of `true`
    // https://url.spec.whatwg.org/#urlencoded-serializing
    const search = REUSED_SEARCH_PARAMS.toString()
    return normalizeSearchParamsEncoding(
      StringPrototypeSlice(search, REUSED_SEARCH_PARAMS_OFFSET),
    )
  }
  return ''
}

/**
 * Encode qualifiers object as URL query string.
 */
function encodeQualifiers(qualifiers: unknown): string {
  if (isObject(qualifiers)) {
    // Sort this list of qualifier strings lexicographically
    const qualifiersKeys = ArrayPrototypeToSorted(ObjectKeys(qualifiers))
    const searchParams = new URLSearchParamsCtor()
    for (let i = 0, { length } = qualifiersKeys; i < length; i += 1) {
      const key = qualifiersKeys[i]!
      const value = prepareValueForSearchParams(
        (qualifiers as Record<string, unknown>)[key],
      )
      // Use URLSearchParams#set to preserve plus signs
      // https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams#preserving_plus_signs
      searchParams.set(key!, value)
    }
    return normalizeSearchParamsEncoding(searchParams.toString())
  }
  return ''
}

/**
 * Encode subpath component for URL.
 */
function encodeSubpath(subpath: unknown): string {
  return isNonEmptyString(subpath)
    ? StringPrototypeReplaceAll(encodeComponent(subpath), '%2F', '/')
    : ''
}

/**
 * Encode package version component for URL.
 */
function encodeVersion(version: unknown): string {
  return isNonEmptyString(version)
    ? StringPrototypeReplaceAll(encodeComponent(version), '%3A', ':')
    : ''
}

/**
 * Normalize URLSearchParams output for qualifier encoding.
 */
function normalizeSearchParamsEncoding(encoded: string): string {
  return StringPrototypeReplaceAll(
    StringPrototypeReplaceAll(encoded, '%2520', '%20'),
    '+',
    '%2B',
  )
}

/**
 * Prepare string value for URLSearchParams encoding.
 */
function prepareValueForSearchParams(value: unknown): string {
  // Replace spaces with %20's so they don't get converted to plus signs
  return StringPrototypeReplaceAll(String(value), ' ', '%20')
}

export {
  encodeComponent,
  encodeName,
  encodeNamespace,
  encodeVersion,
  encodeQualifiers,
  encodeQualifierParam,
  encodeSubpath,
}
