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

import {
  _registerPackageURL,
  compare as comparePurls,
  equals as equalsPurls,
} from './compare.js'
import { decodePurlComponent } from './decode.js'
import { PurlError } from './error.js'
import {
  normalizeName,
  normalizeNamespace,
  normalizeQualifiers,
  normalizeSubpath,
  normalizeType,
  normalizeVersion,
} from './normalize.js'
import { isObject, recursiveFreeze } from './objects.js'
import {
  ArrayIsArray,
  ArrayPrototypeAt,
  JSONParse,
  MapCtor,
  ObjectCreate,
  ObjectFreeze,
  ObjectKeys,
  JSONStringify,
  ReflectDefineProperty,
  ReflectGetOwnPropertyDescriptor,
  ReflectSetPrototypeOf,
  RegExpPrototypeTest,
  StringPrototypeCharCodeAt,
  StringPrototypeIncludes,
  StringPrototypeIndexOf,
  StringPrototypeLastIndexOf,
  StringPrototypeSlice,
  StringPrototypeSplit,
  StringPrototypeStartsWith,
  URLCtor,
  URLSearchParamsCtor,
} from './primordials.js'
import { PurlComponent } from './purl-component.js'
import { PurlQualifierNames } from './purl-qualifier-names.js'
import { PurlType } from './purl-type.js'
import { parseNpmSpecifier } from './purl-types/npm.js'
import { Err, Ok, ResultUtils, err, ok } from './result.js'
import { stringify, stringifySpec } from './stringify.js'
import { isBlank, isNonEmptyString, trimLeadingSlashes } from './strings.js'
import {
  UrlConverter,
  _registerPackageURLForUrlConverter,
} from './url-converter.js'
import {
  validateName,
  validateNamespace,
  validateQualifiers,
  validateSubpath,
  validateType,
  validateVersion,
} from './validate.js'

import type { QualifiersObject } from './purl-component.js'
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

// LRU flyweight cache for fromString — avoids re-parsing identical PURL strings.
// Bounded to prevent memory leaks. Uses a Map for O(1) lookup with LRU eviction.
const FLYWEIGHT_CACHE_MAX = 1024
const flyweightCache = new MapCtor<string, PackageURL>()

// Pattern to match URLs with schemes other than "pkg"
// Limited to 256 chars for scheme to prevent ReDoS
const OTHER_SCHEME_PATTERN = ObjectFreeze(/^[a-zA-Z][a-zA-Z0-9+.-]{0,255}:\/\//)

// Pattern to match purl-like strings with type/name format
// Limited to 256 chars for type to prevent ReDoS
const PURL_LIKE_PATTERN = ObjectFreeze(/^[a-zA-Z0-9+.-]{1,256}\//)

/**
 * Package URL parser and constructor implementing the PURL specification.
 * Provides methods to parse, construct, and manipulate Package URLs with validation and normalization.
 */
class PackageURL {
  static Component = recursiveFreeze(PurlComponent)
  static KnownQualifierNames = recursiveFreeze(PurlQualifierNames)
  static Type = recursiveFreeze(PurlType)

  /** @internal Cached canonical string representation. */
  _cachedString?: string | undefined

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
    const type = isNonEmptyString(rawType) ? normalizeType(rawType) : rawType
    validateType(type, true)

    const namespace = isNonEmptyString(rawNamespace)
      ? normalizeNamespace(rawNamespace)
      : rawNamespace
    validateNamespace(namespace, true)

    const name = isNonEmptyString(rawName) ? normalizeName(rawName) : rawName
    validateName(name, true)

    const version = isNonEmptyString(rawVersion)
      ? normalizeVersion(rawVersion)
      : rawVersion
    validateVersion(version, true)

    const qualifiers =
      typeof rawQualifiers === 'string' || isObject(rawQualifiers)
        ? normalizeQualifiers(rawQualifiers as string | QualifiersObject)
        : rawQualifiers
    validateQualifiers(qualifiers, true)

    const subpath = isNonEmptyString(rawSubpath)
      ? normalizeSubpath(rawSubpath)
      : rawSubpath
    validateSubpath(subpath, true)

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
   * Convert PackageURL to object for JSONStringify compatibility.
   */
  toJSON(): PackageURLObject {
    return this.toObject()
  }

  /**
   * Convert PackageURL to JSON string representation.
   */
  toJSONString(): string {
    return JSONStringify(this.toObject())
  }

  /**
   * Convert PackageURL to a plain object representation.
   */
  toObject(): PackageURLObject {
    const result: PackageURLObject = { __proto__: null } as PackageURLObject
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
      const qualifiersCopy = ObjectCreate(null) as QualifiersObject
      for (const key of ObjectKeys(this.qualifiers)) {
        qualifiersCopy[key] = this.qualifiers[key]!
      }
      result.qualifiers = qualifiersCopy
    }
    if (this.subpath !== undefined) {
      result.subpath = this.subpath
    }
    return result
  }

  /**
   * Get the package specifier string without the scheme and type prefix.
   *
   * Returns `namespace/name@version?qualifiers#subpath` — the package identity
   * without the `pkg:type/` prefix.
   *
   * @returns Spec string (e.g., '@babel/core@7.0.0' for pkg:npm/%40babel/core@7.0.0)
   */
  toSpec() {
    return stringifySpec(this)
  }

  toString() {
    let cached = this._cachedString
    if (cached === undefined) {
      cached = stringify(this)
      this._cachedString = cached
    }
    return cached
  }

  /**
   * Create a new PackageURL with a different version.
   * Returns a new instance — the original is unchanged.
   *
   * @param version - New version string
   * @returns New PackageURL with the updated version
   */
  withVersion(version: string | undefined): PackageURL {
    return new PackageURL(
      this.type,
      this.namespace,
      this.name,
      version,
      this.qualifiers,
      this.subpath,
    )
  }

  /**
   * Create a new PackageURL with a different namespace.
   * Returns a new instance — the original is unchanged.
   *
   * @param namespace - New namespace string
   * @returns New PackageURL with the updated namespace
   */
  withNamespace(namespace: string | undefined): PackageURL {
    return new PackageURL(
      this.type,
      namespace,
      this.name,
      this.version,
      this.qualifiers,
      this.subpath,
    )
  }

  /**
   * Create a new PackageURL with a single qualifier added or updated.
   * Returns a new instance — the original is unchanged.
   *
   * @param key - Qualifier key
   * @param value - Qualifier value
   * @returns New PackageURL with the qualifier set
   */
  withQualifier(key: string, value: string): PackageURL {
    return new PackageURL(
      this.type,
      this.namespace,
      this.name,
      this.version,
      {
        __proto__: null,
        ...this.qualifiers,
        [key]: value,
      } as unknown as Record<string, string>,
      this.subpath,
    )
  }

  /**
   * Create a new PackageURL with all qualifiers replaced.
   * Returns a new instance — the original is unchanged.
   *
   * @param qualifiers - New qualifiers object (or undefined to remove all)
   * @returns New PackageURL with the updated qualifiers
   */
  withQualifiers(qualifiers: Record<string, string> | undefined): PackageURL {
    return new PackageURL(
      this.type,
      this.namespace,
      this.name,
      this.version,
      qualifiers,
      this.subpath,
    )
  }

  /**
   * Create a new PackageURL with a different subpath.
   * Returns a new instance — the original is unchanged.
   *
   * @param subpath - New subpath string
   * @returns New PackageURL with the updated subpath
   */
  withSubpath(subpath: string | undefined): PackageURL {
    return new PackageURL(
      this.type,
      this.namespace,
      this.name,
      this.version,
      this.qualifiers,
      subpath,
    )
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
      parsed = JSONParse(json)
    } catch (e) {
      // For JSON parsing errors, throw a SyntaxError with the expected message
      throw new SyntaxError('Failed to parse PackageURL from JSON', {
        cause: e,
      })
    }

    // Validate parsed result is an object
    if (!parsed || typeof parsed !== 'object' || ArrayIsArray(parsed)) {
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
    // Flyweight: return cached instance for identical strings
    if (typeof purlStr === 'string') {
      const cached = flyweightCache.get(purlStr)
      if (cached !== undefined) {
        // Promote to most-recently-used by re-inserting.
        flyweightCache.delete(purlStr)
        flyweightCache.set(purlStr, cached)
        return cached
      }
    }
    const purl = new PackageURL(...PackageURL.parseString(purlStr))
    // Eagerly populate the toString cache before freezing
    purl.toString()
    // Deep freeze the instance and its nested qualifiers object to prevent
    // cache poisoning via mutation of shared cached instances.
    recursiveFreeze(purl)
    // Cache the frozen result for future lookups — freezing prevents
    // cache poisoning via property mutation on shared instances.
    if (typeof purlStr === 'string') {
      if (flyweightCache.size >= FLYWEIGHT_CACHE_MAX) {
        // Evict oldest entry (first key in Map iteration order)
        const oldest = flyweightCache.keys().next().value
        if (oldest !== undefined) {
          flyweightCache.delete(oldest)
        }
      }
      flyweightCache.set(purlStr, purl)
    }
    return purl
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
    if (!StringPrototypeStartsWith(purlStr, 'pkg:')) {
      // Only auto-prepend "pkg:" if the string looks like a purl (contains a type/name pattern)
      // and doesn't look like a URL with a different scheme
      const hasOtherScheme = RegExpPrototypeTest(OTHER_SCHEME_PATTERN, purlStr)
      const looksLikePurl = RegExpPrototypeTest(PURL_LIKE_PATTERN, purlStr)

      if (!hasOtherScheme && looksLikePurl) {
        return PackageURL.parseString(`pkg:${purlStr}`)
      }
    }

    // Split the remainder once from left on ':'
    const colonIndex = StringPrototypeIndexOf(purlStr, ':')
    // Use WHATWG URL to split up the purl string
    /* v8 ignore next 3 -- Comment lines don't need coverage. */
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
        /* v8 ignore next 8 -- V8 coverage sees multiple branch paths that can't all be tested. */
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
    // When a forward slash ('/') is directly preceding an '@' symbol,
    // then the '@' symbol is NOT considered a version separator
    if (
      atSignIndex > 0 &&
      StringPrototypeCharCodeAt(pathname, atSignIndex - 1) === 47 /*'/'*/
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
      const entries = StringPrototypeSplit(search, '&' as any)
      for (let i = 0, { length } = entries; i < length; i += 1) {
        const pairs = StringPrototypeSplit(entries[i]!, '=' as any)
        if (pairs) {
          const key = pairs[0]!
          // Validate qualifier key is not empty (reject malformed PURLs like ?&key=val or ?key=val&)
          if (key.length === 0) {
            throw new PurlError('qualifier key must not be empty')
          }
          const value = decodePurlComponent(
            'qualifiers',
            ArrayPrototypeAt(pairs, 1) ?? '',
          )
          // Use URLSearchParams#append to preserve plus signs
          // https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams#preserving_plus_signs
          /* v8 ignore next -- URLSearchParams.append has internal V8 branches we can't control. */ searchParams.append(
            key,
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
      rawSubpath = decodePurlComponent('subpath', StringPrototypeSlice(hash, 1))
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

  /**
   * Check if a string is a valid PURL without throwing.
   *
   * @param purlStr - String to validate
   * @returns true if the string is a valid PURL
   *
   * @example
   * ```typescript
   * PackageURL.isValid('pkg:npm/lodash@4.17.21') // true
   * PackageURL.isValid('not a purl')              // false
   * ```
   */
  static isValid(purlStr: unknown): boolean {
    return PackageURL.tryFromString(purlStr).isOk()
  }

  /**
   * Create PackageURL from a registry or repository URL.
   *
   * Convenience wrapper for UrlConverter.fromUrl(). Supports 27 hostnames
   * across 17 package types including npm, pypi, maven, github, and more.
   *
   * @param urlStr - Registry or repository URL
   * @returns PackageURL instance or undefined if URL is not recognized
   *
   * @example
   * ```typescript
   * PackageURL.fromUrl('https://www.npmjs.com/package/lodash')
   * // -> pkg:npm/lodash
   *
   * PackageURL.fromUrl('https://github.com/lodash/lodash')
   * // -> pkg:github/lodash/lodash
   * ```
   */
  static fromUrl(urlStr: string): PackageURL | undefined {
    return UrlConverter.fromUrl(urlStr)
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
  ReflectDefineProperty(PackageURL, staticProp, {
    ...ReflectGetOwnPropertyDescriptor(PackageURL, staticProp),
    writable: false,
  })
}

ReflectSetPrototypeOf(PackageURL.prototype, null)

// Register PackageURL with compare module for string-based comparison support.
_registerPackageURL(PackageURL)

// Register PackageURL with url-converter module for fromUrl construction.
_registerPackageURLForUrlConverter(PackageURL)

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
