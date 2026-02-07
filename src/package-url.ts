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

import { compare as comparePurls, equals as equalsPurls } from './compare.js'
import { decodePurlComponent } from './decode.js'
import { PurlError } from './error.js'
import { isObject, recursiveFreeze } from './objects.js'
import { PurlComponent } from './purl-component.js'
import { PurlQualifierNames } from './purl-qualifier-names.js'
import { PurlType } from './purl-type.js'
import { parseNpmSpecifier } from './purl-types/npm.js'
import { Err, Ok, ResultUtils, err, ok } from './result.js'
import { stringify } from './stringify.js'
import { isBlank, isNonEmptyString, trimLeadingSlashes } from './strings.js'
import { UrlConverter } from './url-converter.js'

import type {
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
  type?: string | undefined
  namespace?: string | undefined
  name?: string | undefined
  version?: string | undefined
  qualifiers?: QualifiersObject | undefined
  subpath?: string | undefined
}

/**
 * Type representing parsed PURL components as a tuple.
 * Returned by PackageURL.parseString() in the order:
 * [type, namespace, name, version, qualifiers, subpath]
 */
export type ParsedPurlComponents = [
  type: string | undefined,
  namespace: string | undefined,
  name: string | undefined,
  version: string | undefined,
  qualifiers: URLSearchParams | undefined,
  subpath: string | undefined,
]

// Pattern to match URLs with schemes other than "pkg"
// Limited to 256 chars for scheme to prevent ReDoS
const OTHER_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]{0,255}:\/\//

// Pattern to match purl-like strings with type/name format
// Limited to 256 chars for type to prevent ReDoS
const PURL_LIKE_PATTERN = /^[a-zA-Z0-9+.-]{1,256}\//

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
      result.type = this.type
    }
    if (this.namespace !== undefined) {
      result.namespace = this.namespace
    }
    if (this.name !== undefined) {
      result.name = this.name
    }
    if (this.version !== undefined) {
      result.version = this.version
    }
    if (this.qualifiers !== undefined) {
      result.qualifiers = this.qualifiers
    }
    if (this.subpath !== undefined) {
      result.subpath = this.subpath
    }
    return result
  }

  toString() {
    return stringify(this)
  }

  /**
   * Compare this PackageURL with another for equality.
   *
   * Two PURLs are considered equal if their canonical string representations match.
   * This comparison is case-sensitive after normalization.
   *
   * @param other - The PackageURL to compare with
   * @returns true if the PURLs are equal, false otherwise
   */
  equals(other: PackageURL): boolean {
    return equalsPurls(this, other)
  }

  /**
   * Compare this PackageURL with another for sorting.
   *
   * Returns a number indicating sort order:
   * - Negative if this comes before other
   * - Zero if they are equal
   * - Positive if this comes after other
   *
   * @param other - The PackageURL to compare with
   * @returns -1, 0, or 1 for sort ordering
   */
  compare(other: PackageURL): -1 | 0 | 1 {
    return comparePurls(this, other)
  }

  /**
   * Compare two PackageURLs for equality.
   *
   * Two PURLs are considered equal if their canonical string representations match.
   *
   * @param a - First PackageURL to compare
   * @param b - Second PackageURL to compare
   * @returns true if the PURLs are equal, false otherwise
   */
  static equals(a: PackageURL, b: PackageURL): boolean {
    return equalsPurls(a, b)
  }

  /**
   * Compare two PackageURLs for sorting.
   *
   * Compares PURLs using their canonical string representations.
   * Returns a number indicating sort order:
   * - Negative if a comes before b
   * - Zero if they are equal
   * - Positive if a comes after b
   *
   * @param a - First PackageURL to compare
   * @param b - Second PackageURL to compare
   * @returns -1, 0, or 1 for sort ordering
   */
  static compare(a: PackageURL, b: PackageURL): -1 | 0 | 1 {
    return comparePurls(a, b)
  }

  /**
   * Create PackageURL from JSON string.
   */
  static fromJSON(json: unknown): PackageURL {
    if (typeof json !== 'string') {
      throw new Error('JSON string argument is required.')
    }

    // Size limit: 1MB to prevent memory exhaustion
    // Check actual byte size, not character length
    const MAX_JSON_SIZE = 1024 * 1024
    const byteSize = Buffer.byteLength(json, 'utf8')
    if (byteSize > MAX_JSON_SIZE) {
      throw new Error(
        `JSON string exceeds maximum size limit of ${MAX_JSON_SIZE} bytes`,
      )
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(json)
    } catch (e) {
      // For JSON parsing errors, throw a SyntaxError with the expected message
      throw new SyntaxError('Failed to parse PackageURL from JSON', {
        cause: e,
      })
    }

    // Validate parsed result is an object
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('JSON must parse to an object.')
    }

    // Cast to record type for safe property access
    const parsedRecord = parsed as Record<string, unknown>

    // Create a safe object without prototype chain to prevent prototype pollution
    const safeObject: PackageURLObject = {
      __proto__: null,
      type: parsedRecord['type'] as string | undefined,
      namespace: parsedRecord['namespace'] as string | undefined,
      name: parsedRecord['name'] as string | undefined,
      version: parsedRecord['version'] as string | undefined,
      qualifiers: parsedRecord['qualifiers'] as
        | Record<string, string>
        | undefined,
      subpath: parsedRecord['subpath'] as string | undefined,
    } as PackageURLObject

    return PackageURL.fromObject(safeObject)
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
    return new PackageURL(...PackageURL.parseString(purlStr))
  }

  /**
   * Create PackageURL from npm package specifier.
   *
   * Parses npm package specifiers and converts them to PackageURL format.
   * Handles scoped packages, version ranges, and normalizes version strings.
   *
   * **Supported formats:**
   * - Basic packages: `lodash`, `lodash@4.17.21`
   * - Scoped packages: `@babel/core`, `@babel/core@7.0.0`
   * - Version ranges: `^4.17.21`, `~1.2.3`, `>=1.0.0` (prefixes stripped)
   * - Dist-tags: `latest`, `next`, `beta` (passed through as version)
   *
   * **Not supported:**
   * - Git URLs: `git+https://...` (use PackageURL constructor directly)
   * - File paths: `file:../package.tgz`
   * - GitHub shortcuts: `user/repo#branch`
   * - Aliases: `npm:package@version`
   *
   * **Note:** Dist-tags like `latest` are mutable and should be resolved to
   * concrete versions for reproducible builds. This method passes them through
   * as-is for convenience.
   *
   * @param specifier - npm package specifier (e.g., 'lodash@4.17.21', '@babel/core@^7.0.0')
   * @returns PackageURL instance for the npm package
   * @throws {Error} If specifier is not a string or is empty
   *
   * @example
   * ```typescript
   * // Basic packages
   * PackageURL.fromNpm('lodash@4.17.21')
   * // -> pkg:npm/lodash@4.17.21
   *
   * // Scoped packages
   * PackageURL.fromNpm('@babel/core@^7.0.0')
   * // -> pkg:npm/%40babel/core@7.0.0
   *
   * // Dist-tags (passed through)
   * PackageURL.fromNpm('react@latest')
   * // -> pkg:npm/react@latest
   *
   * // No version
   * PackageURL.fromNpm('express')
   * // -> pkg:npm/express
   * ```
   */
  static fromNpm(specifier: unknown): PackageURL {
    const { name, namespace, version } = parseNpmSpecifier(specifier)
    return new PackageURL('npm', namespace, name, version, undefined, undefined)
  }

  /**
   * Create PackageURL from ecosystem-specific package specifier.
   *
   * This is a convenience wrapper that delegates to type-specific parsers.
   * Each ecosystem has its own specifier format and parsing rules.
   *
   * **Supported types:**
   * - `npm`: npm package specifiers (e.g., 'lodash@4.17.21', '@babel/core@^7.0.0')
   *
   * @param type - Package ecosystem type (e.g., 'npm', 'pypi', 'maven')
   * @param specifier - Ecosystem-specific package specifier string
   * @returns PackageURL instance for the package
   * @throws {Error} If type is not supported or specifier is invalid
   *
   * @example
   * ```typescript
   * // npm packages
   * PackageURL.fromSpec('npm', 'lodash@4.17.21')
   * // -> pkg:npm/lodash@4.17.21
   *
   * PackageURL.fromSpec('npm', '@babel/core@^7.0.0')
   * // -> pkg:npm/%40babel/core@7.0.0
   * ```
   */
  static fromSpec(type: string, specifier: unknown): PackageURL {
    switch (type) {
      case 'npm': {
        const { name, namespace, version } = parseNpmSpecifier(specifier)
        return new PackageURL(
          'npm',
          namespace,
          name,
          version,
          undefined,
          undefined,
        )
      }
      default:
        throw new Error(
          `Unsupported package type: ${type}. Currently supported: npm`,
        )
    }
  }

  static parseString(purlStr: unknown): ParsedPurlComponents {
    // https://github.com/package-url/purl-spec/blob/master/PURL-SPECIFICATION.rst#how-to-parse-a-purl-string-in-its-components
    if (typeof purlStr !== 'string') {
      throw new Error('A purl string argument is required.')
    }
    if (isBlank(purlStr)) {
      return [undefined, undefined, undefined, undefined, undefined, undefined]
    }

    // Input length validation to prevent DoS
    // Reasonable limit for a package URL
    const MAX_PURL_LENGTH = 4096
    if (purlStr.length > MAX_PURL_LENGTH) {
      throw new Error(
        `Package URL exceeds maximum length of ${MAX_PURL_LENGTH} characters.`,
      )
    }

    // If the string doesn't start with "pkg:" but looks like a purl format, prepend "pkg:" and try parsing
    if (!purlStr.startsWith('pkg:')) {
      // Only auto-prepend "pkg:" if the string looks like a purl (contains a type/name pattern)
      // and doesn't look like a URL with a different scheme
      const hasOtherScheme = OTHER_SCHEME_PATTERN.test(purlStr)
      const looksLikePurl = PURL_LIKE_PATTERN.test(purlStr)

      if (!hasOtherScheme && looksLikePurl) {
        return PackageURL.parseString(`pkg:${purlStr}`)
      }
    }

    // Split the remainder once from left on ':'
    const colonIndex = purlStr.indexOf(':')
    // Use WHATWG URL to split up the purl string
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
    // The scheme is a constant with the value "pkg"
    /* c8 ignore next -- Tested: colonIndex === -1 (url undefined) case, but V8 can't see both branches. */ if (
      url?.protocol !== 'pkg:'
    ) {
      throw new PurlError('missing required "pkg" scheme component')
      /* c8 ignore next -- Unreachable code after throw. */
    }
    // A purl must NOT contain a URL Authority i.e. there is no support for
    // username, password, host and port components
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
    // pnpm ids such as 'pkg:npm/next@14.2.10(react-dom@18.3.1(react@18.3.1))(react@18.3.1)'
    let atSignIndex =
      rawType === 'npm'
        ? pathname.indexOf('@', firstSlashIndex + 2)
        : pathname.lastIndexOf('@')
    /* c8 ignore stop */
    // When a forward slash ('/') is directly preceding an '@' symbol,
    // then the '@' symbol is NOT considered a version separator
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
      // Split the remainder once from right on '@'
      rawVersion = decodePurlComponent(
        'version',
        pathname.slice(atSignIndex + 1),
      )
    }

    let rawNamespace: string | undefined
    let rawName: string
    const lastSlashIndex = beforeVersion.lastIndexOf('/')
    if (lastSlashIndex === -1) {
      // Split the remainder once from right on '/'
      rawName = decodePurlComponent('name', beforeVersion)
    } else {
      // Split the remainder once from right on '/'
      rawName = decodePurlComponent(
        'name',
        beforeVersion.slice(lastSlashIndex + 1),
      )
      // Split the remainder on '/'
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
        const pairs = entries[i]?.split('=')
        if (pairs) {
          const value = decodePurlComponent('qualifiers', pairs.at(1) ?? '')
          // Use URLSearchParams#append to preserve plus signs
          // https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams#preserving_plus_signs
          /* c8 ignore next -- URLSearchParams.append has internal V8 branches we can't control. */ searchParams.append(
            pairs[0]!,
            value,
          )
        }
      }
      // Split the remainder once from right on '?'
      rawQualifiers = searchParams
    }

    let rawSubpath: string | undefined
    const { hash } = url
    if (hash.length !== 0) {
      // Split the purl string once from right on '#'
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

  static tryParseString(purlStr: unknown): Result<unknown[], Error> {
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
  PurlComponent,
  PurlQualifierNames,
  PurlType,
  ResultUtils,
  UrlConverter,
  err,
  ok,
}
export type { DownloadUrl, RepositoryUrl, Result }
