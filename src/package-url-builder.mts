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
 * @file Builder pattern implementation for `PackageURL` construction with
 *   fluent API.
 */
import { PackageURL } from './package-url.mjs'
import { ArrayPrototypeMap } from '@socketsecurity/lib/primordials/array'
import {
  ObjectEntries,
  ObjectFromEntries,
} from '@socketsecurity/lib/primordials/object'
import {
  bitbucket,
  cargo,
  cocoapods,
  composer,
  conan,
  conda,
  cran,
  create,
  deb,
  docker,
  gem,
  github,
  gitlab,
  golang,
  hackage,
  hex,
  huggingface,
  luarocks,
  maven,
  npm,
  nuget,
  oci,
  pub,
  pypi,
  rpm,
  swift,
} from './purl-builder-factories.mjs'

import type { QualifiersValue } from './purl-component.mjs'

/**
 * Known Limitation: `instanceof` checks with ESM/CommonJS interop
 * ==============================================================
 *
 * When using `PurlBuilder` in environments that mix ESM and CommonJS modules
 * (such as Vitest tests importing CommonJS-compiled code as ESM), the
 * `instanceof` operator may not work reliably for checking if the built objects
 * are instances of `PackageURL`.
 *
 * This occurs because: - `PurlBuilder` internally imports `PackageURL` using
 * CommonJS `require()` - External code may import `PackageURL` using ESM
 * `import` - Node.js creates different wrapper objects for the same class - The
 * `instanceof` check fails due to different object identities.
 *
 * Workaround: Instead of: `purl instanceof PackageURL` Use:
 * `purl.constructor.name === 'PackageURL'` or check for expected
 * properties/methods.
 *
 * This limitation only affects `instanceof` checks, not the actual
 * functionality of the created `PackageURL` objects.
 */

/**
 * Builder class for constructing `PackageURL` instances using a fluent API.
 *
 * This class provides a convenient way to build `PackageURL` objects step by
 * step with method chaining. Each method returns the builder instance, allowing
 * for fluent construction patterns.
 *
 * @example
 *   ;```typescript
 *   const purl = PurlBuilder.npm().name('lodash').version('4.17.21').build()
 *   ```
 */
export class PurlBuilder {
  /**
   * The package type (e.g., `'npm'`, `'pypi'`, `'maven'`).
   */
  // oxlint-disable-next-line socket/no-underscore-identifier -- backing field for the same-named fluent setter `type()`; the underscore disambiguates field from method.
  private _type?: string | undefined

  /**
   * The package namespace (organization, group, or scope).
   */
  // oxlint-disable-next-line socket/no-underscore-identifier -- backing field for the same-named fluent setter `namespace()`; the underscore disambiguates field from method.
  private _namespace?: string | undefined

  /**
   * The package name (required for valid `PackageURL`s).
   */
  // oxlint-disable-next-line socket/no-underscore-identifier -- backing field for the same-named fluent setter `name()`; the underscore disambiguates field from method.
  private _name?: string | undefined

  /**
   * The package version string.
   */
  // oxlint-disable-next-line socket/no-underscore-identifier -- backing field for the same-named fluent setter `version()`; the underscore disambiguates field from method.
  private _version?: string | undefined

  /**
   * Key-value pairs of additional package qualifiers.
   */
  // oxlint-disable-next-line socket/no-underscore-identifier -- backing field for the same-named fluent setter `qualifiers()`; the underscore disambiguates field from method.
  private _qualifiers?: Record<string, string> | undefined

  /**
   * Optional subpath within the package.
   */
  // oxlint-disable-next-line socket/no-underscore-identifier -- backing field for the same-named fluent setter `subpath()`; the underscore disambiguates field from method.
  private _subpath?: string | undefined

  /**
   * Build and return the final `PackageURL` instance.
   *
   * This method creates a new `PackageURL` instance using all the properties
   * set on this builder. The `PackageURL` constructor will handle validation
   * and normalization of the provided values.
   *
   * @throws {Error} If the configuration results in an invalid `PackageURL`
   */
  build(): PackageURL {
    return new PackageURL(
      this._type,
      this._namespace,
      this._name,
      this._version,
      this._qualifiers,
      this._subpath,
    )
  }

  /**
   * Set the package name for the `PackageURL`.
   *
   * This is the core identifier for the package and is required for all valid
   * `PackageURL`s. The name should be the canonical package name as it appears
   * in the package repository.
   */
  name(name: string): this {
    this._name = name
    return this
  }

  /**
   * Set the package namespace for the `PackageURL`.
   *
   * The namespace represents different concepts depending on the package type:
   * - `npm`: organization or scope (e.g., `'@angular'` for `'@angular/core'`) -
   * `maven`: `groupId` (e.g., `'org.apache.commons'`) - `pypi`: typically
   * unused.
   */
  namespace(namespace: string): this {
    this._namespace = namespace
    return this
  }

  /**
   * Add a single qualifier key-value pair.
   *
   * This method allows adding qualifiers incrementally. If the qualifier key
   * already exists, its value will be overwritten.
   */
  qualifier(key: string, value: string): this {
    if (!this._qualifiers) {
      this._qualifiers = { __proto__: null } as unknown as Record<
        string,
        string
      >
    }
    this._qualifiers[key] = value
    return this
  }

  /**
   * Set all qualifiers at once, replacing any existing qualifiers.
   *
   * Qualifiers provide additional metadata about the package such as: - `arch`:
   * target architecture - `os`: target operating system - `classifier`:
   * additional classifier for the package.
   */
  qualifiers(qualifiers: Record<string, string>): this {
    this._qualifiers = { __proto__: null, ...qualifiers } as unknown as Record<
      string,
      string
    >
    return this
  }

  /**
   * Set the subpath for the `PackageURL`.
   *
   * The subpath represents a path within the package, useful for referencing
   * specific files or directories within a package. It should not start with a
   * forward slash.
   */
  subpath(subpath: string): this {
    this._subpath = subpath
    return this
  }

  /**
   * Set the package type for the `PackageURL`.
   */
  type(type: string): this {
    this._type = type
    return this
  }

  /**
   * Set the package version for the `PackageURL`.
   *
   * The version string should match the format used by the package repository.
   * Some package types may normalize version formats (e.g., removing leading
   * `'v'`).
   */
  version(version: string): this {
    this._version = version
    return this
  }

  /**
   * Create a builder from an existing `PackageURL` instance.
   *
   * This factory method copies all properties from an existing `PackageURL`
   * into a new builder, allowing for modification of existing URLs.
   */
  static from(purl: PackageURL): PurlBuilder {
    const builder = new PurlBuilder()
    if (purl.type !== undefined) {
      builder._type = purl.type
    }
    if (purl.namespace !== undefined) {
      builder._namespace = purl.namespace
    }
    if (purl.name !== undefined) {
      builder._name = purl.name
    }
    if (purl.version !== undefined) {
      builder._version = purl.version
    }
    if (purl.qualifiers !== undefined) {
      const qualifiersObj = purl.qualifiers
      builder._qualifiers = ObjectFromEntries(
        ArrayPrototypeMap(
          ObjectEntries(qualifiersObj),
          ([key, value]: [string, QualifiersValue]) => [key, String(value)],
        ),
      )
    }
    if (purl.subpath !== undefined) {
      builder._subpath = purl.subpath
    }
    return builder
  }

  static bitbucket = bitbucket
  static cargo = cargo
  static cocoapods = cocoapods
  static composer = composer
  static conan = conan
  static conda = conda
  static cran = cran
  static create = create
  static deb = deb
  static docker = docker
  static gem = gem
  static github = github
  static gitlab = gitlab
  static golang = golang
  static hackage = hackage
  static hex = hex
  static huggingface = huggingface
  static luarocks = luarocks
  static maven = maven
  static npm = npm
  static nuget = nuget
  static oci = oci
  static pub = pub
  static pypi = pypi
  static rpm = rpm
  static swift = swift
}
