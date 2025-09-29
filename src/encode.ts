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

const encodeComponent = globalThis.encodeURIComponent

function encodeName(name: unknown): string {
  return isNonEmptyString(name)
    ? encodeComponent(name).replaceAll('%3A', ':')
    : ''
}

function encodeNamespace(namespace: unknown): string {
  return isNonEmptyString(namespace)
    ? encodeComponent(namespace).replaceAll('%3A', ':').replaceAll('%2F', '/')
    : ''
}

function encodeQualifierParam(param: unknown): string {
  if (isNonEmptyString(param)) {
    // Replace spaces with %20's so they don't get converted to plus signs.
    const value = String(param).replaceAll(' ', '%20')
    // Use URLSearchParams#set to preserve plus signs.
    // https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams#preserving_plus_signs
    REUSED_SEARCH_PARAMS.set(REUSED_SEARCH_PARAMS_KEY, value)
    // Param key and value are encoded with `percentEncodeSet` of
    // 'application/x-www-form-urlencoded' and `spaceAsPlus` of `true`.
    // https://url.spec.whatwg.org/#urlencoded-serializing
    const search = REUSED_SEARCH_PARAMS.toString()
    return search
      .slice(REUSED_SEARCH_PARAMS_OFFSET)
      .replaceAll('%2520', '%20')
      .replaceAll('+', '%2B')
  }
  return ''
}

function encodeQualifiers(qualifiers: unknown): string {
  if (isObject(qualifiers)) {
    // Sort this list of qualifier strings lexicographically.
    const qualifiersKeys = Object.keys(qualifiers).sort()
    const searchParams = new URLSearchParams()
    for (let i = 0, { length } = qualifiersKeys; i < length; i += 1) {
      const key = qualifiersKeys[i]!
      // Replace spaces with %20's so they don't get converted to plus signs.
      const value = String(
        (qualifiers as Record<string, unknown>)[key],
      ).replaceAll(' ', '%20')
      // Use URLSearchParams#set to preserve plus signs.
      // https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams#preserving_plus_signs
      searchParams.set(key!, value)
    }
    return searchParams
      .toString()
      .replaceAll('%2520', '%20')
      .replaceAll('+', '%2B')
  }
  return ''
}

function encodeSubpath(subpath: unknown): string {
  return isNonEmptyString(subpath)
    ? encodeComponent(subpath).replaceAll('%2F', '/')
    : ''
}

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
