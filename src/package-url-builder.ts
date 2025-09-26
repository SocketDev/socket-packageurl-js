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
 * @fileoverview Builder pattern implementation for PackageURL construction with fluent API.
 */
import { PackageURL } from './package-url.js'

import type { QualifiersObject } from './purl-component.js'

/**
 * Builder class for constructing PackageURL instances using a fluent API.
 *
 * This class provides a convenient way to build PackageURL objects step by step
 * with method chaining. Each method returns the builder instance, allowing for
 * fluent construction patterns.
 *
 * @example
 * ```typescript
 * const purl = PackageURLBuilder
 *   .npm()
 *   .name('lodash')
 *   .version('4.17.21')
 *   .build()
 * ```
 */
export class PackageURLBuilder {
  /** The package type (e.g., 'npm', 'pypi', 'maven'). */
  private _type?: string

  /** The package namespace (organization, group, or scope). */
  private _namespace?: string

  /** The package name (required for valid PackageURLs). */
  private _name?: string

  /** The package version string. */
  private _version?: string

  /** Key-value pairs of additional package qualifiers. */
  private _qualifiers?: Record<string, string>

  /** Optional subpath within the package. */
  private _subpath?: string

  /**
   * Set the package type for the PackageURL.
   */
  type(type: string): this {
    this._type = type
    return this
  }

  /**
   * Set the package namespace for the PackageURL.
   *
   * The namespace represents different concepts depending on the package type:
   * - npm: organization or scope (e.g., '@angular' for '@angular/core')
   * - maven: groupId (e.g., 'org.apache.commons')
   * - pypi: typically unused
   */
  namespace(namespace: string): this {
    this._namespace = namespace
    return this
  }

  /**
   * Set the package name for the PackageURL.
   *
   * This is the core identifier for the package and is required for all valid
   * PackageURLs. The name should be the canonical package name as it appears
   * in the package repository.
   */
  name(name: string): this {
    this._name = name
    return this
  }

  /**
   * Set the package version for the PackageURL.
   *
   * The version string should match the format used by the package repository.
   * Some package types may normalize version formats (e.g., removing leading 'v').
   */
  version(version: string): this {
    this._version = version
    return this
  }

  /**
   * Set all qualifiers at once, replacing any existing qualifiers.
   *
   * Qualifiers provide additional metadata about the package such as:
   * - arch: target architecture
   * - os: target operating system
   * - classifier: additional classifier for the package
   */
  qualifiers(qualifiers: Record<string, string>): this {
    this._qualifiers = { ...qualifiers }
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
      this._qualifiers = {}
    }
    this._qualifiers[key] = value
    return this
  }

  /**
   * Set the subpath for the PackageURL.
   *
   * The subpath represents a path within the package, useful for referencing
   * specific files or directories within a package. It should not start with
   * a forward slash.
   */
  subpath(subpath: string): this {
    this._subpath = subpath
    return this
  }

  /**
   * Build and return the final PackageURL instance.
   *
   * This method creates a new PackageURL instance using all the properties
   * set on this builder. The PackageURL constructor will handle validation
   * and normalization of the provided values.
   *
   * @throws {Error} If the configuration results in an invalid PackageURL
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
   * Create a new empty builder instance.
   *
   * This is a convenience factory method that returns a new PackageURLBuilder
   * instance ready for configuration.
   */
  static create(): PackageURLBuilder {
    return new PackageURLBuilder()
  }

  /**
   * Create a builder from an existing PackageURL instance.
   *
   * This factory method copies all properties from an existing PackageURL
   * into a new builder, allowing for modification of existing URLs.
   */
  static from(purl: PackageURL): PackageURLBuilder {
    const builder = new PackageURLBuilder()
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
      const qualifiersObj = purl.qualifiers as QualifiersObject
      builder._qualifiers = Object.fromEntries(
        Object.entries(qualifiersObj).map(([key, value]) => [
          key,
          String(value),
        ]),
      )
    }
    if (purl.subpath !== undefined) {
      builder._subpath = purl.subpath
    }
    return builder
  }

  /**
   * Create a builder with the npm package type preset.
   *
   * This convenience method creates a new builder instance with the type
   * already set to 'npm', ready for building npm package URLs.
   */
  static npm(): PackageURLBuilder {
    return new PackageURLBuilder().type('npm')
  }

  /**
   * Create a builder with the pypi package type preset.
   *
   * This convenience method creates a new builder instance with the type
   * already set to 'pypi', ready for building Python package URLs.
   */
  static pypi(): PackageURLBuilder {
    return new PackageURLBuilder().type('pypi')
  }

  /**
   * Create a builder with the maven package type preset.
   *
   * This convenience method creates a new builder instance with the type
   * already set to 'maven', ready for building Maven package URLs.
   */
  static maven(): PackageURLBuilder {
    return new PackageURLBuilder().type('maven')
  }

  /**
   * Create a builder with the gem package type preset.
   *
   * This convenience method creates a new builder instance with the type
   * already set to 'gem', ready for building Ruby gem URLs.
   */
  static gem(): PackageURLBuilder {
    return new PackageURLBuilder().type('gem')
  }

  /**
   * Create a builder with the golang package type preset.
   *
   * This convenience method creates a new builder instance with the type
   * already set to 'golang', ready for building Go package URLs.
   */
  static golang(): PackageURLBuilder {
    return new PackageURLBuilder().type('golang')
  }

  /**
   * Create a builder with the cargo package type preset.
   *
   * This convenience method creates a new builder instance with the type
   * already set to 'cargo', ready for building Rust crate URLs.
   */
  static cargo(): PackageURLBuilder {
    return new PackageURLBuilder().type('cargo')
  }

  /**
   * Create a builder with the nuget package type preset.
   *
   * This convenience method creates a new builder instance with the type
   * already set to 'nuget', ready for building NuGet package URLs.
   */
  static nuget(): PackageURLBuilder {
    return new PackageURLBuilder().type('nuget')
  }

  /**
   * Create a builder with the composer package type preset.
   *
   * This convenience method creates a new builder instance with the type
   * already set to 'composer', ready for building Composer package URLs.
   */
  static composer(): PackageURLBuilder {
    return new PackageURLBuilder().type('composer')
  }
}
