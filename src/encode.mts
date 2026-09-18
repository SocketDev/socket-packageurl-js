/**
 * @file URL encoding functions for PURL components. Provides special handling
 *   for names, namespaces, versions, qualifiers, and subpaths.
 */
import { isObject } from './objects.mjs'
import { ArrayPrototypeToSorted } from '@socketsecurity/lib/primordials/array'
import { encodeURIComponent as GlobalEncodeUriComponent } from '@socketsecurity/lib/primordials/globals'
import { ObjectKeys } from '@socketsecurity/lib/primordials/object'
import {
  StringPrototypeIndexOf,
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
    ? StringPrototypeReplaceAll(encodePurlComponent(name), '%3A', ':')
    : ''
}

/**
 * Encode package namespace component for URL.
 */
export function encodeNamespace(namespace: unknown): string {
  return isNonEmptyString(namespace)
    ? StringPrototypeReplaceAll(
        StringPrototypeReplaceAll(encodePurlComponent(namespace), '%3A', ':'),
        '%2F',
        '/',
      )
    : ''
}

export function encodePurlComponent(value: string): string {
  return StringPrototypeReplaceAll(
    encodeComponent(value),
    /[!'()*]/g,
    character => {
      switch (character) {
        case '!':
          return '%21'
        case "'":
          return '%27'
        case '(':
          return '%28'
        case ')':
          return '%29'
        default:
          return '%2A'
      }
    },
  )
}

/**
 * Encode qualifier parameter key or value.
 */
export function encodeQualifierParam(param: unknown): string {
  if (isNonEmptyString(param)) {
    const value = param
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
      const value = String((qualifiers as Record<string, unknown>)[key])
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
        StringPrototypeReplaceAll(encodePurlComponent(subpath), '%2F', '/'),
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
    ? StringPrototypeReplaceAll(encodePurlComponent(version), '%3A', ':')
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
  encoded = StringPrototypeReplaceAll(encoded, '*', '%2A')
  // Every pattern below is either a percent-escape or a literal '+', so a
  // string holding neither character is already normalized. Most qualifier
  // values are plain, and the guard turns four full scans into two.
  if (
    StringPrototypeIndexOf(encoded, '%') === -1 &&
    StringPrototypeIndexOf(encoded, '+') === -1
  ) {
    return encoded
  }
  return StringPrototypeReplaceAll(
    StringPrototypeReplaceAll(
      StringPrototypeReplaceAll(encoded, '+', '%20'),
      '%3A',
      ':',
    ),
    '%7E',
    '~',
  )
}

export { encodeComponent }
