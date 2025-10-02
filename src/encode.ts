/**
 * @fileoverview URL encoding functions for PURL components.
 * Provides special handling for names, namespaces, versions, qualifiers, and subpaths.
 */
import {
  REUSED_SEARCH_PARAMS,
  REUSED_SEARCH_PARAMS_KEY,
  REUSED_SEARCH_PARAMS_OFFSET,
} from './constants.js'
import { isObject } from './objects.js'
import { isNonEmptyString } from './strings.js'

// IMPORTANT: Do not use destructuring here (e.g., const { encodeURIComponent } = globalThis).
// tsgo has a bug that incorrectly transpiles destructured exports, resulting in
// `exports.encodeComponent = void 0;` which causes runtime errors.
// See: https://github.com/SocketDev/socket-packageurl-js/issues/3
const encodeComponent = globalThis.encodeURIComponent

/**
 * Encode package name component for URL.
 */
function encodeName(name: unknown): string {
  return isNonEmptyString(name)
    ? encodeComponent(name).replaceAll('%3A', ':')
    : ''
}

/**
 * Encode package namespace component for URL.
 */
function encodeNamespace(namespace: unknown): string {
  return isNonEmptyString(namespace)
    ? encodeComponent(namespace).replaceAll('%3A', ':').replaceAll('%2F', '/')
    : ''
}

/**
 * Normalize URLSearchParams output for qualifier encoding.
 */
function normalizeSearchParamsEncoding(encoded: string): string {
  return encoded.replaceAll('%2520', '%20').replaceAll('+', '%2B')
}

/**
 * Prepare string value for URLSearchParams encoding.
 */
function prepareValueForSearchParams(value: unknown): string {
  // Replace spaces with %20's so they don't get converted to plus signs.
  return String(value).replaceAll(' ', '%20')
}

/**
 * Encode qualifier parameter key or value.
 */
function encodeQualifierParam(param: unknown): string {
  if (isNonEmptyString(param)) {
    const value = prepareValueForSearchParams(param)
    // Use URLSearchParams#set to preserve plus signs.
    // https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams#preserving_plus_signs
    REUSED_SEARCH_PARAMS.set(REUSED_SEARCH_PARAMS_KEY, value)
    // Param key and value are encoded with `percentEncodeSet` of
    // 'application/x-www-form-urlencoded' and `spaceAsPlus` of `true`.
    // https://url.spec.whatwg.org/#urlencoded-serializing
    const search = REUSED_SEARCH_PARAMS.toString()
    return normalizeSearchParamsEncoding(
      search.slice(REUSED_SEARCH_PARAMS_OFFSET),
    )
  }
  return ''
}

/**
 * Encode qualifiers object as URL query string.
 */
function encodeQualifiers(qualifiers: unknown): string {
  if (isObject(qualifiers)) {
    // Sort this list of qualifier strings lexicographically.
    const qualifiersKeys = Object.keys(qualifiers).sort()
    const searchParams = new URLSearchParams()
    for (let i = 0, { length } = qualifiersKeys; i < length; i += 1) {
      const key = qualifiersKeys[i]!
      const value = prepareValueForSearchParams(
        (qualifiers as Record<string, unknown>)[key],
      )
      // Use URLSearchParams#set to preserve plus signs.
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
    ? encodeComponent(subpath).replaceAll('%2F', '/')
    : ''
}

/**
 * Encode package version component for URL.
 */
function encodeVersion(version: unknown): string {
  return isNonEmptyString(version)
    ? encodeComponent(version).replaceAll('%3A', ':')
    : ''
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
