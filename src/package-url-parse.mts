/*!
Copyright (c) the purl authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

/**
 * @file Low-level PURL string parser. Implements `parseString` — the step that
 *   splits a raw purl string into its six components without constructing a
 *   `PackageURL` instance.
 */

import { decodePurlComponent } from './decode.mjs'
import { PurlError } from './error.mjs'
import { ObjectFreeze } from '@socketsecurity/lib/primordials/object'
import { RegExpPrototypeTest } from '@socketsecurity/lib/primordials/regexp'
import {
  StringPrototypeIncludes,
  StringPrototypeIndexOf,
  StringPrototypeLastIndexOf,
  StringPrototypeSlice,
  StringPrototypeSplit,
  StringPrototypeStartsWith,
} from '@socketsecurity/lib/primordials/string'
import {
  URLCtor,
  URLSearchParamsCtor,
} from '@socketsecurity/lib/primordials/url'
import { ErrorCtor } from '@socketsecurity/lib/primordials/error'
import { isBlank, trimLeadingSlashes } from './strings.mjs'

import type { ParsedPurlComponents } from './package-url.mjs'

// Pattern to match URLs with schemes other than "pkg"
// Limited to 256 chars for scheme to prevent ReDoS
const OTHER_SCHEME_PATTERN = ObjectFreeze(/^[a-zA-Z][a-zA-Z0-9+.-]{0,255}:\/\//)

// Pattern to match purl-like strings with type/name format
// Limited to 256 chars for type to prevent ReDoS
const PURL_LIKE_PATTERN = ObjectFreeze(/^[a-zA-Z0-9+.-]{1,256}\//)

/**
 * Parse a purl string into its components without constructing a `PackageURL`.
 */
export function parseString(purlStr: unknown): ParsedPurlComponents {
  // https://github.com/package-url/purl-spec/blob/main/PURL-SPECIFICATION.rst#how-to-parse-a-purl-string-in-its-components
  if (typeof purlStr !== 'string') {
    throw new ErrorCtor('A purl string argument is required.')
  }
  if (isBlank(purlStr)) {
    return [undefined, undefined, undefined, undefined, undefined, undefined]
  }

  // Input length validation to prevent DoS
  // Reasonable limit for a package URL
  const MAX_PURL_LENGTH = 4096
  if (purlStr.length > MAX_PURL_LENGTH) {
    throw new ErrorCtor(
      `Package URL exceeds maximum length of ${MAX_PURL_LENGTH} characters.`,
    )
  }

  // If the string doesn't start with "pkg:" but looks like a purl format,
  // prepend "pkg:" and try parsing
  if (!StringPrototypeStartsWith(purlStr, 'pkg:')) {
    // Only auto-prepend "pkg:" if the string looks like a purl (contains a
    // type/name pattern) and doesn't look like a URL with a different scheme
    const hasOtherScheme = RegExpPrototypeTest(OTHER_SCHEME_PATTERN, purlStr)
    const looksLikePurl = RegExpPrototypeTest(PURL_LIKE_PATTERN, purlStr)

    if (!hasOtherScheme && looksLikePurl) {
      return parseString(`pkg:${purlStr}`)
    }
  }

  // Split the remainder once from left on ':'
  const colonIndex = StringPrototypeIndexOf(purlStr, ':')
  // Use WHATWG URL to split up the purl string:
  //   - Split the purl string once from right on '#'
  //   - Split the remainder once from right on '?'
  //   - Split the remainder once from left on ':'
  let url: URL | undefined
  let hasAuth = false
  if (colonIndex !== -1) {
    try {
      // Since a purl never contains a URL Authority, its scheme
      // must not be suffixed with double slash as in 'pkg://'
      // and should use instead 'pkg:'. Purl parsers must accept
      // URLs such as 'pkg://' and must ignore the '//'
      const beforeColon = StringPrototypeSlice(purlStr, 0, colonIndex)
      const afterColon = StringPrototypeSlice(purlStr, colonIndex + 1)
      const trimmedAfterColon = trimLeadingSlashes(afterColon)
      url = new URLCtor(`${beforeColon}:${trimmedAfterColon}`)
      // Check for auth (user:pass@host) without creating a second URL.
      // When leading slashes were trimmed, the original string had an authority
      // section (e.g., pkg://user:pass@host/...). Detect `@` in the authority
      // by checking between the `//` and the next `/`.
      /* v8 ignore start - V8 coverage sees multiple branch paths that can't all be tested. */
      if (afterColon.length !== trimmedAfterColon.length) {
        // afterColon starts with slashes — find the authority section
        const authorityStart = StringPrototypeIndexOf(afterColon, '//') + 2
        const authorityEnd = StringPrototypeIndexOf(
          afterColon,
          '/',
          authorityStart,
        )
        const authority =
          authorityEnd === -1
            ? StringPrototypeSlice(afterColon, authorityStart)
            : StringPrototypeSlice(afterColon, authorityStart, authorityEnd)
        hasAuth = StringPrototypeIncludes(authority, '@')
      }
      /* v8 ignore stop */
    } catch (e) {
      throw new PurlError('failed to parse as URL', {
        cause: e,
      })
    }
  }
  // The scheme is a constant with the value "pkg"
  /* v8 ignore next -- Tested: colonIndex === -1 (url undefined) case, but V8 can't see both branches. */ if (
    url?.protocol !== 'pkg:'
  ) {
    throw new PurlError('missing required "pkg" scheme component')
    /* v8 ignore next -- Unreachable code after throw. */
  }
  // A purl must NOT contain a URL Authority i.e. there is no support for
  // username, password, host and port components
  if (hasAuth) {
    throw new PurlError('cannot contain a "user:pass@host:port"')
  }

  const { pathname } = url
  const firstSlashIndex = StringPrototypeIndexOf(pathname, '/')
  const rawType = decodePurlComponent(
    'type',
    firstSlashIndex === -1
      ? pathname
      : StringPrototypeSlice(pathname, 0, firstSlashIndex),
  )
  if (firstSlashIndex < 1) {
    return [rawType, undefined, undefined, undefined, undefined, undefined]
  }

  let rawVersion: string | undefined
  // Both branches of this ternary are tested, but V8 reports phantom branch combinations
  /* v8 ignore start -- npm vs non-npm path logic both tested but V8 sees extra branches. */
  // Deviate from the specification to handle a special npm purl type case for
  // pnpm ids such as 'pkg:npm/next@14.2.10(react-dom@18.3.1(react@18.3.1))(react@18.3.1)'
  let atSignIndex =
    rawType === 'npm'
      ? StringPrototypeIndexOf(pathname, '@', firstSlashIndex + 2)
      : StringPrototypeLastIndexOf(pathname, '@')
  /* v8 ignore stop */
  // An '@' before the last '/' is namespace/name content (e.g. a raw
  // npm-style '@scope' namespace) — only an '@' after the last '/' separates
  // the version. An '@' DIRECTLY after that last '/' still separates: the
  // name left of it is empty and required-name validation rejects the purl,
  // matching the spec rule that a literal '@' in a name must be
  // percent-encoded (purl-spec fixtures: `pkg:vcpkg/@1.0.8` and
  // `pkg:julia/@1.9.0` must fail to parse).
  if (
    atSignIndex !== -1 &&
    atSignIndex < StringPrototypeLastIndexOf(pathname, '/')
  ) {
    atSignIndex = -1
  }
  const beforeVersion = StringPrototypeSlice(
    pathname,
    rawType.length + 1,
    atSignIndex === -1 ? pathname.length : atSignIndex,
  )
  if (atSignIndex !== -1) {
    // Split the remainder once from right on '@'
    rawVersion = decodePurlComponent(
      'version',
      StringPrototypeSlice(pathname, atSignIndex + 1),
    )
  }

  let rawNamespace: string | undefined
  let rawName: string
  const lastSlashIndex = StringPrototypeLastIndexOf(beforeVersion, '/')
  if (lastSlashIndex === -1) {
    // Split the remainder once from right on '/'
    rawName = decodePurlComponent('name', beforeVersion)
  } else {
    // Split the remainder once from right on '/'
    rawName = decodePurlComponent(
      'name',
      StringPrototypeSlice(beforeVersion, lastSlashIndex + 1),
    )
    // Split the remainder on '/'
    rawNamespace = decodePurlComponent(
      'namespace',
      StringPrototypeSlice(beforeVersion, 0, lastSlashIndex),
    )
  }

  let rawQualifiers: URLSearchParams | undefined
  if (url.searchParams.size !== 0) {
    const search = StringPrototypeSlice(url.search, 1)
    const searchParams = new URLSearchParamsCtor()
    const entries = StringPrototypeSplit(search, '&')
    for (let i = 0, { length } = entries; i < length; i += 1) {
      const entry = entries[i]!
      // Slice on the FIRST '=' so values containing '=' (e.g.
      // download_url=https://example.com/x?a=1, base64 padding `==`)
      // round-trip intact. Splitting on '=' and indexing [1] silently
      // truncates everything after the second '='.
      const eqIndex = StringPrototypeIndexOf(entry, '=')
      const key =
        eqIndex === -1 ? entry : StringPrototypeSlice(entry, 0, eqIndex)
      // Validate qualifier key is not empty (reject malformed PURLs like ?&key=val or ?key=val&)
      if (key.length === 0) {
        throw new PurlError('qualifier key must not be empty')
      }
      const value = decodePurlComponent(
        'qualifiers',
        eqIndex === -1 ? '' : StringPrototypeSlice(entry, eqIndex + 1),
      )
      // Use `URLSearchParams#append` to preserve plus signs
      // https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams#preserving_plus_signs
      /* v8 ignore next -- URLSearchParams.append has internal V8 branches we can't control. */ searchParams.append(
        key,
        value,
      )
    }
    // Split the remainder once from right on '?'
    rawQualifiers = searchParams
  }

  let rawSubpath: string | undefined
  const { hash } = url
  if (hash.length !== 0) {
    // Split the purl string once from right on '#'
    rawSubpath = decodePurlComponent('subpath', StringPrototypeSlice(hash, 1))
  }

  return [rawType, rawNamespace, rawName, rawVersion, rawQualifiers, rawSubpath]
}
