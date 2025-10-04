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
 * @fileoverview Package URL parsing and construction utilities.
 *
 * Note on instanceof checks:
 * When this module is compiled to CommonJS and imported from ESM contexts,
 * instanceof checks may fail due to module system interoperability issues.
 * See package-url-builder.ts for detailed explanation and workarounds.
 */
import { decodePurlComponent } from './decode.js'
import { PurlError } from './error.js'
import { isObject, recursiveFreeze } from './objects.js'
import { PackageURLBuilder } from './package-url-builder.js'
import { PurlComponent } from './purl-component.js'
import { PurlQualifierNames } from './purl-qualifier-names.js'
import { PurlType } from './purl-type.js'
import { Err, Ok, ResultUtils, err, ok } from './result.js'
import { isBlank, isNonEmptyString, trimLeadingSlashes } from './strings.js'
import { UrlConverter } from './url-converter.js'

import type {
  ComponentEncoder,
  ComponentNormalizer,
  ComponentValidator,
  QualifiersObject,
} from './purl-component.js'
import type { Result } from './result.js'
import type { DownloadUrl, RepositoryUrl } from './url-converter.js'

/**
 * Type representing the possible values for PackageURL component properties.
 * Used for index signature to allow dynamic property access.
 */
export type PackageURLComponentValue = string | QualifiersObject | undefined

/**
 * Type representing a plain object representation of a PackageURL.
 * Contains all package URL components as properties.
 */
export type PackageURLObject = {
  type?: string
  namespace?: string
  name?: string
  version?: string
  qualifiers?: QualifiersObject
  subpath?: string
}

// Pattern to match URLs with schemes other than "pkg".
const OTHER_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//

// Pattern to match purl-like strings with type/name format.
const PURL_LIKE_PATTERN = /^[a-zA-Z0-9+.-]+\//

/**
 * Package URL parser and constructor implementing the PURL specification.
 * Provides methods to parse, construct, and manipulate Package URLs with validation and normalization.
 */
class PackageURL {
  static Component = recursiveFreeze(PurlComponent)
  static KnownQualifierNames = recursiveFreeze(PurlQualifierNames)
  static Type = recursiveFreeze(PurlType)

  name?: string | undefined
  namespace?: string | undefined
  qualifiers?: QualifiersObject | undefined
  subpath?: string | undefined
  type?: string | undefined
  version?: string | undefined

  constructor(
    rawType: unknown,
    rawNamespace: unknown,
    rawName: unknown,
    rawVersion: unknown,
    rawQualifiers: unknown,
    rawSubpath: unknown,
  ) {
    const type = isNonEmptyString(rawType)
      ? (PurlComponent['type']?.['normalize'] as ComponentNormalizer)?.(rawType)
      : rawType
    ;(PurlComponent['type']?.['validate'] as ComponentValidator)?.(type, true)

    const namespace = isNonEmptyString(rawNamespace)
      ? (PurlComponent['namespace']?.['normalize'] as ComponentNormalizer)?.(
          rawNamespace,
        )
      : rawNamespace
    ;(PurlComponent['namespace']?.['validate'] as ComponentValidator)?.(
      namespace,
      true,
    )

    const name = isNonEmptyString(rawName)
      ? (PurlComponent['name']?.['normalize'] as ComponentNormalizer)?.(rawName)
      : rawName
    ;(PurlComponent['name']?.['validate'] as ComponentValidator)?.(name, true)

    const version = isNonEmptyString(rawVersion)
      ? (PurlComponent['version']?.['normalize'] as ComponentNormalizer)?.(
          rawVersion,
        )
      : rawVersion
    ;(PurlComponent['version']?.['validate'] as ComponentValidator)?.(
      version,
      true,
    )

    const qualifiers =
      typeof rawQualifiers === 'string' || isObject(rawQualifiers)
        ? (
            PurlComponent['qualifiers']?.['normalize'] as (
              _value: string | QualifiersObject,
            ) => Record<string, string> | undefined
          )?.(rawQualifiers as string | QualifiersObject)
        : rawQualifiers
    ;(PurlComponent['qualifiers']?.['validate'] as ComponentValidator)?.(
      qualifiers,
      true,
    )

    const subpath = isNonEmptyString(rawSubpath)
      ? (PurlComponent['subpath']?.['normalize'] as ComponentNormalizer)?.(
          rawSubpath,
        )
      : rawSubpath
    ;(PurlComponent['subpath']?.['validate'] as ComponentValidator)?.(
      subpath,
      true,
    )

    this.type = type as string
    this.name = name as string
    if (namespace !== undefined) {
      this.namespace = namespace as string
    }
    if (version !== undefined) {
      this.version = version as string
    }
    this.qualifiers = (qualifiers as QualifiersObject) ?? undefined
    if (subpath !== undefined) {
      this.subpath = subpath as string
    }

    const typeHelpers = PurlType[type as string]
    if (typeHelpers) {
      ;(typeHelpers?.['normalize'] as (_purl: PackageURL) => void)?.(this)
      ;(
        typeHelpers?.['validate'] as (
          _purl: PackageURL,
          _throws: boolean,
        ) => boolean
      )?.(this, true)
    }
  }

  /**
   * Convert PackageURL to object for JSON.stringify compatibility.
   */
  toJSON(): PackageURLObject {
    return this.toObject()
  }

  /**
   * Convert PackageURL to JSON string representation.
   */
  toJSONString(): string {
    return JSON.stringify(this.toObject())
  }

  /**
   * Convert PackageURL to a plain object representation.
   */
  toObject(): PackageURLObject {
    const result: PackageURLObject = {}
    if (this.type !== undefined) {
      result['type'] = this.type
    }
    if (this.namespace !== undefined) {
      result['namespace'] = this.namespace
    }
    if (this.name !== undefined) {
      result['name'] = this.name
    }
    if (this.version !== undefined) {
      result['version'] = this.version
    }
    if (this.qualifiers !== undefined) {
      result['qualifiers'] = this.qualifiers
    }
    if (this.subpath !== undefined) {
      result['subpath'] = this.subpath
    }
    return result
  }

  toString() {
    const {
      name,
      namespace,
      qualifiers,
      subpath,
      type,
      version,
    }: {
      name?: string | undefined
      namespace?: string | undefined
      qualifiers?: QualifiersObject | undefined
      subpath?: string | undefined
      type?: string | undefined
      version?: string | undefined
    } = this
    /* c8 ignore next - Type encoder uses default PurlComponentEncoder, never returns null/undefined. */ let purlStr = `pkg:${(PurlComponent['type']?.['encode'] as ComponentEncoder)?.(type) ?? ''}/`
    if (namespace) {
      /* c8 ignore next - Namespace encoder always returns string, never null/undefined. */ purlStr = `${purlStr}${(PurlComponent['namespace']?.['encode'] as ComponentEncoder)?.(namespace) ?? ''}/`
    }
    /* c8 ignore next - Name encoder always returns string, never null/undefined. */ purlStr = `${purlStr}${(PurlComponent['name']?.['encode'] as ComponentEncoder)?.(name) ?? ''}`
    if (version) {
      /* c8 ignore next - Version encoder always returns string, never null/undefined. */ purlStr = `${purlStr}@${(PurlComponent['version']?.['encode'] as ComponentEncoder)?.(version) ?? ''}`
    }
    if (qualifiers) {
      /* c8 ignore next - Qualifiers encoder always returns string, never null/undefined. */ purlStr = `${purlStr}?${(PurlComponent['qualifiers']?.['encode'] as ComponentEncoder)?.(qualifiers) ?? ''}`
    }
    if (subpath) {
      /* c8 ignore next - Subpath encoder always returns string, never null/undefined. */ purlStr = `${purlStr}#${(PurlComponent['subpath']?.['encode'] as ComponentEncoder)?.(subpath) ?? ''}`
    }
    return purlStr
  }

  /**
   * Create PackageURL from JSON string.
   */
  static fromJSON(json: unknown): PackageURL {
    if (typeof json !== 'string') {
      throw new Error('JSON string argument is required.')
    }
    try {
      return PackageURL.fromObject(JSON.parse(json))
    } catch (e) {
      throw new Error('Invalid JSON string.', { cause: e })
    }
  }

  /**
   * Create PackageURL from a plain object.
   */
  static fromObject(obj: unknown): PackageURL {
    if (!isObject(obj)) {
      throw new Error('Object argument is required.')
    }
    const typedObj = obj as Record<string, unknown>
    return new PackageURL(
      typedObj['type'],
      typedObj['namespace'],
      typedObj['name'],
      typedObj['version'],
      typedObj['qualifiers'],
      typedObj['subpath'],
    )
  }

  static fromString(purlStr: unknown): PackageURL {
    return new PackageURL(
      ...(PackageURL.parseString(purlStr) as [
        unknown,
        unknown,
        unknown,
        unknown,
        unknown,
        unknown,
      ]),
    )
  }

  static parseString(purlStr: unknown): unknown[] {
    // https://github.com/package-url/purl-spec/blob/master/PURL-SPECIFICATION.rst#how-to-parse-a-purl-string-in-its-components
    if (typeof purlStr !== 'string') {
      throw new Error('A purl string argument is required.')
    }
    if (isBlank(purlStr)) {
      return [undefined, undefined, undefined, undefined, undefined, undefined]
    }

    // If the string doesn't start with "pkg:" but looks like a purl format, prepend "pkg:" and try parsing.
    if (!purlStr.startsWith('pkg:')) {
      // Only auto-prepend "pkg:" if the string looks like a purl (contains a type/name pattern)
      // and doesn't look like a URL with a different scheme
      const hasOtherScheme = OTHER_SCHEME_PATTERN.test(purlStr)
      const looksLikePurl = PURL_LIKE_PATTERN.test(purlStr)

      if (!hasOtherScheme && looksLikePurl) {
        return PackageURL.parseString(`pkg:${purlStr}`)
      }
    }

    // Split the remainder once from left on ':'.
    const colonIndex = purlStr.indexOf(':')
    // Use WHATWG URL to split up the purl string.
    /* c8 ignore next 3 -- Comment lines don't need coverage. */
    //   - Split the purl string once from right on '#'
    //   - Split the remainder once from right on '?'
    //   - Split the remainder once from left on ':'
    let url: URL | undefined
    let maybeUrlWithAuth: URL | undefined
    if (colonIndex !== -1) {
      try {
        // Since a purl never contains a URL Authority, its scheme
        // must not be suffixed with double slash as in 'pkg://'
        // and should use instead 'pkg:'. Purl parsers must accept
        // URLs such as 'pkg://' and must ignore the '//'
        const beforeColon = purlStr.slice(0, colonIndex)
        const afterColon = purlStr.slice(colonIndex + 1)
        const trimmedAfterColon = trimLeadingSlashes(afterColon)
        url = new URL(`${beforeColon}:${trimmedAfterColon}`)
        /* c8 ignore next 4 -- V8 coverage sees multiple branch paths in ternary that can't all be tested. */ maybeUrlWithAuth =
          afterColon.length === trimmedAfterColon.length
            ? url
            : new URL(purlStr)
      } catch (e) {
        throw new PurlError('failed to parse as URL', {
          cause: e,
        })
      }
    }
    // The scheme is a constant with the value "pkg".
    /* c8 ignore next -- Tested: colonIndex === -1 (url undefined) case, but V8 can't see both branches. */ if (
      url?.protocol !== 'pkg:'
    ) {
      throw new PurlError('missing required "pkg" scheme component')
      /* c8 ignore next -- Unreachable code after throw. */
    }
    // A purl must NOT contain a URL Authority i.e. there is no support for
    // username, password, host and port components.
    if (
      maybeUrlWithAuth &&
      (maybeUrlWithAuth.username !== '' || maybeUrlWithAuth.password !== '')
    ) {
      throw new PurlError('cannot contain a "user:pass@host:port"')
    }

    const { pathname } = url
    const firstSlashIndex = pathname.indexOf('/')
    const rawType = decodePurlComponent(
      'type',
      firstSlashIndex === -1 ? pathname : pathname.slice(0, firstSlashIndex),
    )
    if (firstSlashIndex < 1) {
      return [rawType, undefined, undefined, undefined, undefined, undefined]
    }

    let rawVersion: string | undefined
    // Both branches of this ternary are tested, but V8 reports phantom branch combinations
    /* c8 ignore start -- npm vs non-npm path logic both tested but V8 sees extra branches. */
    // Deviate from the specification to handle a special npm purl type case for
    // pnpm ids such as 'pkg:npm/next@14.2.10(react-dom@18.3.1(react@18.3.1))(react@18.3.1)'.
    let atSignIndex =
      rawType === 'npm'
        ? pathname.indexOf('@', firstSlashIndex + 2)
        : pathname.lastIndexOf('@')
    /* c8 ignore stop */
    // When a forward slash ('/') is directly preceding an '@' symbol,
    // then the '@' symbol is NOT considered a version separator.
    if (
      atSignIndex !== -1 &&
      pathname.charCodeAt(atSignIndex - 1) === 47 /*'/'*/
    ) {
      atSignIndex = -1
    }
    const beforeVersion = pathname.slice(
      rawType.length + 1,
      atSignIndex === -1 ? pathname.length : atSignIndex,
    )
    if (atSignIndex !== -1) {
      // Split the remainder once from right on '@'.
      rawVersion = decodePurlComponent(
        'version',
        pathname.slice(atSignIndex + 1),
      )
    }

    let rawNamespace: string | undefined
    let rawName: string
    const lastSlashIndex = beforeVersion.lastIndexOf('/')
    if (lastSlashIndex === -1) {
      // Split the remainder once from right on '/'.
      rawName = decodePurlComponent('name', beforeVersion)
    } else {
      // Split the remainder once from right on '/'.
      rawName = decodePurlComponent(
        'name',
        beforeVersion.slice(lastSlashIndex + 1),
      )
      // Split the remainder on '/'.
      rawNamespace = decodePurlComponent(
        'namespace',
        beforeVersion.slice(0, lastSlashIndex),
      )
    }

    let rawQualifiers: URLSearchParams | undefined
    if (url.searchParams.size !== 0) {
      const search = url.search.slice(1)
      const searchParams = new URLSearchParams()
      const entries = search.split('&')
      for (let i = 0, { length } = entries; i < length; i += 1) {
        const pairs = entries[i]!.split('=')
        const value = decodePurlComponent('qualifiers', pairs.at(1) ?? '')
        // Use URLSearchParams#append to preserve plus signs.
        // https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams#preserving_plus_signs
        /* c8 ignore next -- URLSearchParams.append has internal V8 branches we can't control. */ searchParams.append(
          pairs[0]!,
          value,
        )
      }
      // Split the remainder once from right on '?'.
      rawQualifiers = searchParams
    }

    let rawSubpath: string | undefined
    const { hash } = url
    if (hash.length !== 0) {
      // Split the purl string once from right on '#'.
      rawSubpath = decodePurlComponent('subpath', hash.slice(1))
    }

    return [
      rawType,
      rawNamespace,
      rawName,
      rawVersion,
      rawQualifiers,
      rawSubpath,
    ]
  }

  static tryFromJSON(json: unknown): Result<PackageURL, Error> {
    return ResultUtils.from(() => PackageURL.fromJSON(json))
  }

  static tryFromObject(obj: unknown): Result<PackageURL, Error> {
    return ResultUtils.from(() => PackageURL.fromObject(obj))
  }

  static tryFromString(purlStr: unknown): Result<PackageURL, Error> {
    return ResultUtils.from(() => PackageURL.fromString(purlStr))
  }

  static tryParseString(purlStr: unknown): Result<any[], Error> {
    return ResultUtils.from(() => PackageURL.parseString(purlStr))
  }
}

for (const staticProp of ['Component', 'KnownQualifierNames', 'Type']) {
  Reflect.defineProperty(PackageURL, staticProp, {
    ...Reflect.getOwnPropertyDescriptor(PackageURL, staticProp),
    writable: false,
  })
}

Reflect.setPrototypeOf(PackageURL.prototype, null)

export {
  Err,
  Ok,
  PackageURL,
  PackageURLBuilder,
  PurlComponent,
  PurlQualifierNames,
  PurlType,
  ResultUtils,
  UrlConverter,
  err,
  ok,
}
export type { DownloadUrl, RepositoryUrl, Result }
