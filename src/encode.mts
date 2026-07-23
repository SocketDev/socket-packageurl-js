/**
 * @file URL encoding functions for PURL components. Provides special handling
 *   for names, namespaces, versions, qualifiers, and subpaths.
 */
import { isObject } from './objects.mjs'
import { ArrayPrototypeToSorted } from '@socketsecurity/lib/primordials/array'
import { encodeURIComponent as GlobalEncodeUriComponent } from '@socketsecurity/lib/primordials/globals'
import { ObjectKeys } from '@socketsecurity/lib/primordials/object'
import {
  StringPrototypeReplaceAll,
  StringPrototypeSlice,
} from '@socketsecurity/lib/primordials/string'
import { URLSearchParamsCtor } from '@socketsecurity/lib/primordials/url'
import { isNonEmptyString } from './strings.mjs'

// packageurl-js's public `encodeComponent` is the global encodeURIComponent.
// lib 6.0.3 dropped the `encodeComponent` alias from primordials/globals, so
// re-derive it here from the canonically-named global.
const encodeComponent = GlobalEncodeUriComponent

// Module-private reusable `URLSearchParams` for `encodeQualifierParam`. Kept
// private here so mutation side-effects can't leak to other modules.
const REUSED_SEARCH_PARAMS = new URLSearchParamsCtor()
const REUSED_SEARCH_PARAMS_KEY = '_'
// `'_='.length`
const REUSED_SEARCH_PARAMS_OFFSET = 2

/**
 * Encode package name component for URL.
 */
export function encodeName(name: unknown): string {
  return isNonEmptyString(name)
    ? StringPrototypeReplaceAll(encodeComponent(name), '%3A', ':')
    : ''
}

/**
 * Encode package namespace component for URL.
 */
export function encodeNamespace(namespace: unknown): string {
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
export function encodeQualifierParam(param: unknown): string {
  if (isNonEmptyString(param)) {
    const value = prepareValueForSearchParams(param)
    // Use `URLSearchParams#set` to preserve plus signs
    // https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams#preserving_plus_signs
    // Reuse shared instance — JS is single-threaded so no concurrent mutation issues
    REUSED_SEARCH_PARAMS.set(REUSED_SEARCH_PARAMS_KEY, value)
    // Param key and value are encoded with `percentEncodeSet` of
    // `'application/x-www-form-urlencoded'` and `spaceAsPlus` of `true`
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
export function encodeQualifiers(qualifiers: unknown): string {
  if (isObject(qualifiers)) {
    // Sort this list of qualifier strings lexicographically
    const qualifiersKeys: string[] = ArrayPrototypeToSorted(
      ObjectKeys(qualifiers),
    )
    const searchParams = new URLSearchParamsCtor()
    for (let i = 0, { length } = qualifiersKeys; i < length; i += 1) {
      const key = qualifiersKeys[i]!
      const value = prepareValueForSearchParams(
        (qualifiers as Record<string, unknown>)[key],
      )
      // Use `URLSearchParams#set` to preserve plus signs
      // https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams#preserving_plus_signs
      searchParams.set(key, value)
    }
    return normalizeSearchParamsEncoding(searchParams.toString())
  }
  return ''
}

/**
 * Encode subpath component for URL.
 */
export function encodeSubpath(subpath: unknown): string {
  // Per the purl spec, the colon ':' is never percent-encoded ("whether used
  // as a Separator Character or otherwise"), so restore it like the name,
  // namespace, and version encoders do. The '/' segment separator stays a
  // literal slash in a subpath.
  return isNonEmptyString(subpath)
    ? StringPrototypeReplaceAll(
        StringPrototypeReplaceAll(encodeComponent(subpath), '%2F', '/'),
        '%3A',
        ':',
      )
    : ''
}

/**
 * Encode package version component for URL.
 */
export function encodeVersion(version: unknown): string {
  return isNonEmptyString(version)
    ? StringPrototypeReplaceAll(encodeComponent(version), '%3A', ':')
    : ''
}

/**
 * Normalize `URLSearchParams` output for qualifier encoding.
 *
 * `URLSearchParams` applies `application/x-www-form-urlencoded` escaping, which
 * is stricter than the purl spec. The spec lists characters that "shall not be
 * percent-encoded" in a qualifier value; of the ones form-encoding wrongly
 * escapes, restore the colon ':' (spec: never encoded, "whether used as a
 * Separator Character or otherwise") and the tilde '~' (an unreserved
 * Punctuation Character). The slash '/' and at sign '@' stay percent-encoded
 * inside a value — they are not in the spec's no-encode set there.
 */
export function normalizeSearchParamsEncoding(encoded: string): string {
  return StringPrototypeReplaceAll(
    StringPrototypeReplaceAll(
      StringPrototypeReplaceAll(
        StringPrototypeReplaceAll(encoded, '%2520', '%20'),
        '+',
        '%2B',
      ),
      '%3A',
      ':',
    ),
    '%7E',
    '~',
  )
}

/**
 * Prepare string value for `URLSearchParams` encoding.
 */
export function prepareValueForSearchParams(value: unknown): string {
  // Replace spaces with `%20`'s so they don't get converted to plus signs
  return StringPrototypeReplaceAll(String(value), ' ', '%20')
}

export { encodeComponent }
