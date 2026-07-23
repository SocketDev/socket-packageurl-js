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
 * @file Package URL parsing and construction utilities. Note on `instanceof`
 *   checks: When this module is compiled to CommonJS and imported from ESM
 *   contexts, `instanceof` checks may fail due to module system
 *   interoperability issues. See `package-url-builder.ts` for detailed
 *   explanation and workarounds.
 */

import {
  compare as comparePurls,
  equals as equalsPurls,
  registerPackageURL,
} from './compare.mjs'
import {
  normalizeName,
  normalizeNamespace,
  normalizeQualifiers,
  normalizeSubpath,
  normalizeType,
  normalizeVersion,
} from './normalize.mjs'
import { isObject, recursiveFreeze } from './objects.mjs'
import { JSONStringify } from '@socketsecurity/lib/primordials/json'
import {
  ObjectCreate,
  ObjectKeys,
} from '@socketsecurity/lib/primordials/object'
import {
  ReflectDefineProperty,
  ReflectGetOwnPropertyDescriptor,
  ReflectSetPrototypeOf,
} from '@socketsecurity/lib/primordials/reflect'
import { PurlComponent } from './purl-component.mjs'
import { PurlQualifierNames } from './purl-qualifier-names.mjs'
import { PurlType, PurlTypeValidator, PurlTypNormalizer } from './purl-type.mjs'
import { Err, err, Ok, ok, ResultUtils } from './result.mjs'
import { stringify, stringifySpec } from './stringify.mjs'
import {
  registerPackageURLForUrlConverter,
  UrlConverter,
} from './url-converter.mjs'
import {
  validateName,
  validateNamespace,
  validateQualifiers,
  validateSubpath,
  validateType,
  validateVersion,
} from './validate.mjs'
import {
  fromJSON,
  fromNpm,
  fromObject,
  fromSpec,
  fromString,
  fromUrl,
  isValid,
  parseString,
  registerPackageURLStatics,
  tryFromJSON,
  tryFromObject,
  tryFromString,
  tryParseString,
} from './package-url-statics.mjs'
import { isNonEmptyString } from './strings.mjs'

import type { QualifiersObject } from './purl-component.mjs'
import type { Result } from './result.mjs'
import type { DownloadUrl, RepositoryUrl } from './url-converter.mjs'

/**
 * Type representing the possible values for `PackageURL` component properties.
 * Used for index signature to allow dynamic property access.
 */
export type PackageURLComponentValue = string | QualifiersObject | undefined

/**
 * Type representing a plain object representation of a `PackageURL`. Contains
 * all package URL components as properties.
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
 * Type representing parsed PURL components as a tuple. Returned by
 * `PackageURL.parseString()` in the order: `[type, namespace, name, version,
 * qualifiers, subpath]`
 */
export type ParsedPurlComponents = [
  type: string | undefined,
  namespace: string | undefined,
  name: string | undefined,
  version: string | undefined,
  qualifiers: URLSearchParams | undefined,
  subpath: string | undefined,
]

/**
 * Package URL parser and constructor implementing the PURL specification.
 * Provides methods to parse, construct, and manipulate Package URLs with
 * validation and normalization.
 */
export class PackageURL {
  static Component = recursiveFreeze(PurlComponent)
  static KnownQualifierNames = recursiveFreeze(PurlQualifierNames)
  static Type = recursiveFreeze(PurlType)

  /**
   * @internal Cached canonical string representation.
   */
  cachedString?: string | undefined

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
    validateType(type, { throws: true })

    const namespace = isNonEmptyString(rawNamespace)
      ? normalizeNamespace(rawNamespace)
      : rawNamespace
    validateNamespace(namespace, { throws: true })

    const name = isNonEmptyString(rawName) ? normalizeName(rawName) : rawName
    validateName(name, { throws: true })

    const version = isNonEmptyString(rawVersion)
      ? normalizeVersion(rawVersion)
      : rawVersion
    validateVersion(version, { throws: true })

    const qualifiers =
      typeof rawQualifiers === 'string' || isObject(rawQualifiers)
        ? normalizeQualifiers(rawQualifiers)
        : rawQualifiers
    validateQualifiers(qualifiers, { throws: true })

    const subpath = isNonEmptyString(rawSubpath)
      ? normalizeSubpath(rawSubpath)
      : rawSubpath
    validateSubpath(subpath, { throws: true })

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

    // Registered types carry their own normalize/validate helpers; any
    // unregistered type falls back to the default pair so injection
    // protection (PurlTypeValidator) runs for EVERY type, not just the
    // enumerated ones. Without this fallback, `pkg:<unknown>/na$(x)me`
    // would skip validation entirely and smuggle shell metacharacters
    // through name/namespace — security must be opt-out, not opt-in.
    const typeHelpers = PurlType[type as string]
    const normalize = (typeHelpers?.['normalize'] ?? PurlTypNormalizer) as (
      _purl: PackageURL,
    ) => void
    const validate = (typeHelpers?.['validate'] ?? PurlTypeValidator) as (
      _purl: PackageURL,
      _options?: { throws?: boolean | undefined } | undefined,
    ) => boolean
    normalize(this)
    validate(this, { throws: true })
  }

  /**
   * Convert `PackageURL` to object for `JSON.stringify` compatibility.
   */
  toJSON(): PackageURLObject {
    return this.toObject()
  }

  /**
   * Convert `PackageURL` to JSON string representation.
   */
  toJSONString(): string {
    return JSONStringify(this.toObject())
  }

  /**
   * Convert `PackageURL` to a plain object representation.
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
      // oxlint-disable-next-line socket/prefer-undefined-over-null -- Object.create(null) / Reflect.setPrototypeOf(_, null) require the null sentinel.
      const qualifiersCopy = ObjectCreate(null) as QualifiersObject
      const keys = ObjectKeys(this.qualifiers)
      for (let i = 0, { length } = keys; i < length; i += 1) {
        const key = keys[i]!
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
   * @returns Spec string (e.g., `'@babel/core@7.0.0'` for
   *   `pkg:npm/%40babel/core@7.0.0`)
   */
  toSpec() {
    return stringifySpec(this)
  }

  toString() {
    let cached = this.cachedString
    if (cached === undefined) {
      cached = stringify(this)
      this.cachedString = cached
    }
    return cached
  }

  /**
   * Create a new `PackageURL` with a different version. Returns a new instance
   * — the original is unchanged.
   *
   * @param version - New version string.
   *
   * @returns New `PackageURL` with the updated version
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
   * Create a new `PackageURL` with a different namespace. Returns a new
   * instance — the original is unchanged.
   *
   * @param namespace - New namespace string.
   *
   * @returns New `PackageURL` with the updated namespace
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
   * Create a new `PackageURL` with a single qualifier added or updated. Returns
   * a new instance — the original is unchanged.
   *
   * Keys are lowercased per the PURL spec. Values are trimmed, and a value that
   * is empty after trimming drops the qualifier entirely.
   *
   * @param key - Qualifier key (will be lowercased)
   * @param value - Qualifier value (trimmed; empty-after-trim drops the key)
   *
   * @returns New `PackageURL` with the qualifier set
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
      },
      this.subpath,
    )
  }

  /**
   * Create a new `PackageURL` with all qualifiers replaced. Returns a new
   * instance — the original is unchanged.
   *
   * @param qualifiers - New qualifiers object (or `undefined` to remove all)
   *
   * @returns New `PackageURL` with the updated qualifiers
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
   * Create a new `PackageURL` with a different subpath. Returns a new instance
   * — the original is unchanged.
   *
   * @param subpath - New subpath string.
   *
   * @returns New `PackageURL` with the updated subpath
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
   * Compare this `PackageURL` with another for equality.
   *
   * Two `purl`s are considered equal if their canonical string representations
   * match. This comparison is case-sensitive after normalization.
   *
   * @param other - The `PackageURL` to compare with.
   *
   * @returns `true` if the `purl`s are equal, `false` otherwise
   */
  equals(other: PackageURL): boolean {
    return equalsPurls(this, other)
  }

  static equals(a: PackageURL, b: PackageURL): boolean {
    return equalsPurls(a, b)
  }

  compare(other: PackageURL): -1 | 0 | 1 {
    return comparePurls(this, other)
  }

  static compare(a: PackageURL, b: PackageURL): -1 | 0 | 1 {
    return comparePurls(a, b)
  }

  static fromJSON(json: unknown): PackageURL {
    return fromJSON(json)
  }

  static fromObject(obj: unknown): PackageURL {
    return fromObject(obj)
  }

  static fromString(purlStr: unknown): PackageURL {
    return fromString(purlStr)
  }

  static fromNpm(specifier: unknown): PackageURL {
    return fromNpm(specifier)
  }

  static fromSpec(type: string, specifier: unknown): PackageURL {
    return fromSpec(type, specifier)
  }

  static parseString(purlStr: unknown): ParsedPurlComponents {
    return parseString(purlStr)
  }

  static isValid(purlStr: unknown): boolean {
    return isValid(purlStr)
  }

  static fromUrl(urlStr: string): PackageURL | undefined {
    return fromUrl(urlStr)
  }

  static tryFromJSON(json: unknown): Result<PackageURL> {
    return tryFromJSON(json)
  }

  static tryFromObject(obj: unknown): Result<PackageURL> {
    return tryFromObject(obj)
  }

  static tryFromString(purlStr: unknown): Result<PackageURL> {
    return tryFromString(purlStr)
  }

  static tryParseString(purlStr: unknown): Result<unknown[]> {
    return tryParseString(purlStr)
  }
}

const staticProps = ['Component', 'KnownQualifierNames', 'Type']
for (let i = 0, { length } = staticProps; i < length; i += 1) {
  // Loop bound guarantees i < length, so staticProps[i] is defined.
  const staticProp = staticProps[i]!
  ReflectDefineProperty(PackageURL, staticProp, {
    ...ReflectGetOwnPropertyDescriptor(PackageURL, staticProp),
    writable: false,
  })
}

// oxlint-disable-next-line socket/prefer-undefined-over-null -- Object.create(null) / Reflect.setPrototypeOf(_, null) require the null sentinel.
ReflectSetPrototypeOf(PackageURL.prototype, null)

registerPackageURL(PackageURL)
registerPackageURLForUrlConverter(PackageURL)
registerPackageURLStatics(PackageURL)

export {
  Err,
  Ok,
  PurlComponent,
  PurlQualifierNames,
  PurlType,
  ResultUtils,
  UrlConverter,
  err,
  ok,
}
export type { DownloadUrl, RepositoryUrl, Result }
