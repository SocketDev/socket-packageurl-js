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
 * @fileoverview Core unit tests for PackageURL class.
 * Tests the main PackageURL API including constructor validation, toString/fromString parsing,
 * encoding/decoding, qualifiers, subpaths, known qualifier names immutability, input validation,
 * and support for parsing without the "pkg:" prefix for improved developer ergonomics.
 */
import { describe, expect, it } from 'vitest'

import { PackageURL } from '../src/package-url.js'
import {
  testInvalidParam,
  testInvalidStringParam,
  testValidParam,
  testValidStringParam,
} from './utils/param-validation.mjs'
import { createTestPurl } from './utils/test-helpers.mjs'

describe('PackageURL', () => {
  describe('KnownQualifierNames', () => {
    it.each([
      ['Checksum', 'checksum'],
      ['DownloadUrl', 'download_url'],
      ['FileName', 'file_name'],
      ['RepositoryUrl', 'repository_url'],
      ['VcsUrl', 'vcs_url'],
      ['Vers', 'vers'],
    ])('maps: %s => %s', (name, expectedValue) => {
      expect(
        PackageURL.KnownQualifierNames[
          name as keyof typeof PackageURL.KnownQualifierNames
        ],
      ).toBe(expectedValue)
    })

    it('readonly: cannot be written', () => {
      expect(() => {
        // @ts-expect-error Testing runtime immutability.
        PackageURL.KnownQualifierNames = { foo: 'bar' }
      }).toThrow(TypeError)
      expect(PackageURL.KnownQualifierNames).not.toStrictEqual({
        foo: 'bar',
      })
    })

    it('frozen: cannot be modified', () => {
      expect(() => {
        // @ts-expect-error Testing runtime immutability.
        PackageURL.KnownQualifierNames.foo = 'bar'
      }).toThrow(TypeError)
      // @ts-expect-error Testing runtime immutability.
      expect(PackageURL.KnownQualifierNames.foo).toBe(undefined)
    })
  })

  describe('isValid', () => {
    it('should return true for valid PURLs', () => {
      expect(PackageURL.isValid('pkg:npm/lodash@4.17.21')).toBe(true)
      expect(PackageURL.isValid('pkg:maven/org.apache/commons@1.0')).toBe(true)
    })

    it('should return false for invalid PURLs', () => {
      expect(PackageURL.isValid('not a purl')).toBe(false)
      expect(PackageURL.isValid('')).toBe(false)
      expect(PackageURL.isValid(null)).toBe(false)
      expect(PackageURL.isValid(123)).toBe(false)
    })
  })

  describe('fromUrl', () => {
    it('should convert registry URLs to PackageURLs', () => {
      const purl = PackageURL.fromUrl('https://www.npmjs.com/package/lodash')
      expect(purl?.type).toBe('npm')
      expect(purl?.name).toBe('lodash')
    })

    it('should return undefined for unrecognized URLs', () => {
      expect(PackageURL.fromUrl('https://example.com/foo')).toBeUndefined()
    })
  })

  describe('with* immutable copy methods', () => {
    const purl = PackageURL.fromString('pkg:npm/%40babel/core@7.0.0')

    it('withVersion should return new instance with different version', () => {
      const updated = purl.withVersion('8.0.0')
      expect(updated.version).toBe('8.0.0')
      expect(purl.version).toBe('7.0.0') // original unchanged
      expect(updated.name).toBe('core')
      expect(updated.namespace).toBe('@babel')
    })

    it('withVersion(undefined) should remove version', () => {
      const updated = purl.withVersion(undefined)
      expect(updated.version).toBeUndefined()
    })

    it('withNamespace should return new instance', () => {
      const updated = purl.withNamespace('@scope')
      expect(updated.namespace).toBe('@scope')
      expect(purl.namespace).toBe('@babel')
    })

    it('withQualifier should add a qualifier', () => {
      const updated = purl.withQualifier('arch', 'x86_64')
      expect(updated.qualifiers).toEqual({ arch: 'x86_64' })
      expect(purl.qualifiers).toBeUndefined()
    })

    it('withQualifier should preserve existing qualifiers', () => {
      const p = PackageURL.fromString('pkg:npm/foo@1.0?a=1')
      const updated = p.withQualifier('b', '2')
      expect(updated.qualifiers).toEqual({ a: '1', b: '2' })
    })

    it('withQualifiers should replace all qualifiers', () => {
      const updated = purl.withQualifiers({ platform: 'linux-x64' })
      expect(updated.qualifiers).toEqual({ platform: 'linux-x64' })
    })

    it('withQualifiers(undefined) should remove all qualifiers', () => {
      const p = PackageURL.fromString('pkg:npm/foo@1.0?a=1')
      const updated = p.withQualifiers(undefined)
      expect(updated.qualifiers).toBeUndefined()
    })

    it('withSubpath should set subpath', () => {
      const updated = purl.withSubpath('dist/index.js')
      expect(updated.subpath).toBe('dist/index.js')
      expect(purl.subpath).toBeUndefined()
    })

    it('withSubpath(undefined) should remove subpath', () => {
      const p = PackageURL.fromString('pkg:npm/foo@1.0#dist')
      const updated = p.withSubpath(undefined)
      expect(updated.subpath).toBeUndefined()
    })
  })

  describe('toSpec', () => {
    it('should return name only for simple packages', () => {
      const purl = PackageURL.fromString('pkg:npm/express')
      expect(purl.toSpec()).toBe('express')
    })

    it('should return name@version', () => {
      const purl = PackageURL.fromString('pkg:npm/lodash@4.17.21')
      expect(purl.toSpec()).toBe('lodash@4.17.21')
    })

    it('should include namespace with slash separator', () => {
      const purl = PackageURL.fromString('pkg:npm/%40babel/core@7.0.0')
      expect(purl.toSpec()).toBe('%40babel/core@7.0.0')
    })

    it('should include qualifiers', () => {
      const purl = PackageURL.fromString(
        'pkg:npm/lodash@4.17.21?repository_url=https://example.com',
      )
      expect(purl.toSpec()).toBe(
        'lodash@4.17.21?repository_url=https%3A%2F%2Fexample.com',
      )
    })

    it('should include subpath', () => {
      const purl = PackageURL.fromString(
        'pkg:npm/lodash@4.17.21#dist/lodash.js',
      )
      expect(purl.toSpec()).toBe('lodash@4.17.21#dist/lodash.js')
    })

    it('should handle maven namespace', () => {
      const purl = PackageURL.fromString(
        'pkg:maven/org.apache.commons/commons-lang3@3.12.0',
      )
      expect(purl.toSpec()).toBe('org.apache.commons/commons-lang3@3.12.0')
    })

    it('should handle package with no version', () => {
      const purl = PackageURL.fromString('pkg:github/lodash/lodash')
      expect(purl.toSpec()).toBe('lodash/lodash')
    })
  })

  describe('constructor', () => {
    const paramMap = {
      type: 0,
      namespace: 1,
      name: 2,
      version: 3,
      qualifiers: 4,
      subpath: 5,
    }

    const createArgs = (
      paramName: string,
      value: unknown,
    ): [unknown, unknown, unknown, unknown, unknown, unknown] => {
      const args: [unknown, unknown, unknown, unknown, unknown, unknown] = [
        'type',
        'namespace',
        'name',
        'version',
        undefined,
        'subpath',
      ]
      args[paramMap[paramName as keyof typeof paramMap]] = value
      return args
    }

    it('should validate required params', () => {
      // Tests that type and name are required (various invalid inputs)

      for (const paramName of ['type', 'name']) {
        testValidParam(paramName, paramMap, createArgs)
        testInvalidParam(paramName, paramMap, createArgs)
      }
    })

    it('should validate string params', () => {
      // Tests that namespace, version, subpath only accept strings or null/undefined

      for (const paramName of ['namespace', 'version', 'subpath']) {
        testValidStringParam(paramName, paramMap, createArgs)
        testInvalidStringParam(paramName, paramMap, createArgs)
      }
    })

    it('should not decode params', () => {
      // Tests that constructor params are treated as already-decoded (double encoding prevention)
      expect(
        createTestPurl('type', 'name', {
          namespace: '%21',
        }).toString(),
      ).toBe('pkg:type/%2521/name')
      expect(
        createTestPurl('type', '%21', {
          namespace: 'namespace',
        }).toString(),
      ).toBe('pkg:type/namespace/%2521')
      expect(
        createTestPurl('type', 'name', {
          namespace: 'namespace',
          version: '%21',
        }).toString(),
      ).toBe('pkg:type/namespace/name@%2521')
      expect(
        createTestPurl('type', 'name', {
          namespace: 'namespace',
          qualifiers: {
            a: '%21',
          },
          version: '1.0',
        }).toString(),
      ).toBe('pkg:type/namespace/name@1.0?a=%2521')
      expect(
        new PackageURL(
          'type',
          'namespace',
          'name',
          '1.0',
          'a=%2521',
          undefined,
        ).toString(),
      ).toBe('pkg:type/namespace/name@1.0?a=%2521')
      expect(
        createTestPurl('type', 'name', {
          namespace: 'namespace',
          qualifiers: null,
          subpath: '%21',
          version: '1.0',
        }).toString(),
      ).toBe('pkg:type/namespace/name@1.0#%2521')
    })
  })

  describe('toString()', () => {
    it.each(['ty#pe', 'ty@pe', 'ty/pe', '1type'])(
      'type %s is validated and rejected',
      type => {
        // Tests type validation rules (no special chars, can't start with number)
        expect(
          () =>
            new PackageURL(
              type,
              undefined,
              'name',
              undefined,
              undefined,
              undefined,
            ),
        ).toThrow(/contains an illegal character|cannot start with a number/)
      },
    )

    it.each([
      ['#', '%23', 'fragment delimiter'],
      ['@', '%40', 'version separator'],
    ] as const)(
      'should encode special character %s as %s (%s)',
      (char, encoded, _description) => {
        const purl = createTestPurl('type', `na${char}me`, {
          namespace: `name${char}space`,
          qualifiers: { foo: `bar${char}baz` },
          subpath: `sub${char}path`,
          version: `ver${char}sion`,
        })

        const str = purl.toString()
        // Verify all occurrences are encoded
        expect(str).toContain(`name${encoded}space`)
        expect(str).toContain(`na${encoded}me`)
        expect(str).toContain(`ver${encoded}sion`)
        expect(str).toContain(`bar${encoded}baz`)
        expect(str).toContain(`sub${encoded}path`)
      },
    )

    it('path components encode /', () => {
      /* only namespace is allowed to have multiple segments separated by `/`` */
      const purl = createTestPurl('type', 'na/me', {
        namespace: 'namespace1/namespace2',
      })
      expect(purl.toString()).toBe('pkg:type/namespace1/namespace2/na%2Fme')
    })
  })

  describe('fromString()', () => {
    it('with qualifiers.checksums', () => {
      const purlString =
        'pkg:npm/packageurl-js@0.0.7?checksums=sha512:b9c27369720d948829a98118e9a35fd09d9018711e30dc2df5f8ae85bb19b2ade4679351c4d96768451ee9e841e5f5a36114a9ef98f4fe5256a5f4ca981736a0'
      const purl = PackageURL.fromString(purlString)

      expect(purl.type).toBe('npm')
      expect(purl.namespace).toBe(undefined)
      expect(purl.name).toBe('packageurl-js')
      expect(purl.version).toBe('0.0.7')
      expect(purl.qualifiers).toStrictEqual({
        __proto__: null,
        checksums:
          'sha512:b9c27369720d948829a98118e9a35fd09d9018711e30dc2df5f8ae85bb19b2ade4679351c4d96768451ee9e841e5f5a36114a9ef98f4fe5256a5f4ca981736a0',
      })
    })

    it('with qualifiers.vcs_url', () => {
      const purlString =
        'pkg:npm/packageurl-js@0.0.7?vcs_url=git%2Bhttps%3A%2F%2Fgithub.com%2Fpackage-url%2Fpackageurl-js.git'
      const purl = PackageURL.fromString(purlString)

      expect(purl.type).toBe('npm')
      expect(purl.namespace).toBe(undefined)
      expect(purl.name).toBe('packageurl-js')
      expect(purl.version).toBe('0.0.7')
      expect(purl.qualifiers).toStrictEqual({
        __proto__: null,
        vcs_url: 'git+https://github.com/package-url/packageurl-js.git',
      })
    })

    it('npm PURL with namespace starting with @', () => {
      const purlString = 'pkg:npm/@aws-crypto/crc32@3.0.0'
      const purl = PackageURL.fromString(purlString)

      expect(purl.type).toBe('npm')
      expect(purl.namespace).toBe('@aws-crypto')
      expect(purl.name).toBe('crc32')
      expect(purl.version).toBe('3.0.0')
    })

    it('namespace with multiple segments', () => {
      const purl = PackageURL.fromString(
        'pkg:type/namespace1/namespace2/na%2Fme',
      )
      expect(purl.type).toBe('type')
      expect(purl.namespace).toBe('namespace1/namespace2')
      expect(purl.name).toBe('na/me')
    })

    it('encoded #', () => {
      const purl = PackageURL.fromString(
        'pkg:type/name%23space/na%23me@ver%23sion?foo=bar%23baz#sub%23path',
      )
      expect(purl.type).toBe('type')
      expect(purl.namespace).toBe('name#space')
      expect(purl.name).toBe('na#me')
      expect(purl.version).toBe('ver#sion')
      expect(purl.qualifiers).toStrictEqual({
        __proto__: null,
        foo: 'bar#baz',
      })
      expect(purl.subpath).toBe('sub#path')
    })

    it('encoded @', () => {
      const purl = PackageURL.fromString(
        'pkg:type/name%40space/na%40me@ver%40sion?foo=bar%40baz#sub%40path',
      )
      expect(purl.type).toBe('type')
      expect(purl.namespace).toBe('name@space')
      expect(purl.name).toBe('na@me')
      expect(purl.version).toBe('ver@sion')
      expect(purl.qualifiers).toStrictEqual({
        __proto__: null,
        foo: 'bar@baz',
      })
      expect(purl.subpath).toBe('sub@path')
    })

    it('should error on decode failures', () => {
      // Tests malformed percent-encoding detection (c8 ignore case in decode.js)
      expect(() => PackageURL.fromString('pkg:type/100%/name')).toThrow(
        /unable to decode "namespace" component/,
      )
      expect(() => PackageURL.fromString('pkg:type/namespace/100%')).toThrow(
        /unable to decode "name" component/,
      )
      expect(() =>
        PackageURL.fromString('pkg:type/namespace/name@100%'),
      ).toThrow(/unable to decode "version" component/)
      expect(() =>
        PackageURL.fromString('pkg:type/namespace/name@1.0?a=100%'),
      ).toThrow(/unable to decode "qualifiers" component/)
      expect(() =>
        PackageURL.fromString('pkg:type/namespace/name@1.0#100%'),
      ).toThrow(/unable to decode "subpath" component/)
    })
  })

  describe('fromString() without pkg: prefix', () => {
    it('should parse basic purl without pkg: prefix', () => {
      const purl = PackageURL.fromString('npm/lodash@4.17.21')
      expect(purl.type).toBe('npm')
      expect(purl.namespace).toBe(undefined)
      expect(purl.name).toBe('lodash')
      expect(purl.version).toBe('4.17.21')
      expect(purl.toString()).toBe('pkg:npm/lodash@4.17.21')
    })

    it('should parse purl with namespace without pkg: prefix', () => {
      const purl = PackageURL.fromString('npm/@aws-crypto/crc32@3.0.0')
      expect(purl.type).toBe('npm')
      expect(purl.namespace).toBe('@aws-crypto')
      expect(purl.name).toBe('crc32')
      expect(purl.version).toBe('3.0.0')
      expect(purl.toString()).toBe('pkg:npm/%40aws-crypto/crc32@3.0.0')
    })

    it('should parse purl with qualifiers without pkg: prefix', () => {
      const purl = PackageURL.fromString('npm/express@4.18.2?arch=x64&os=linux')
      expect(purl.type).toBe('npm')
      expect(purl.name).toBe('express')
      expect(purl.version).toBe('4.18.2')
      expect(purl.qualifiers).toStrictEqual({
        __proto__: null,
        arch: 'x64',
        os: 'linux',
      })
      expect(purl.toString()).toBe('pkg:npm/express@4.18.2?arch=x64&os=linux')
    })

    it('should parse purl with subpath without pkg: prefix', () => {
      const purl = PackageURL.fromString('npm/lodash@4.17.21#lib/index.js')
      expect(purl.type).toBe('npm')
      expect(purl.name).toBe('lodash')
      expect(purl.version).toBe('4.17.21')
      expect(purl.subpath).toBe('lib/index.js')
      expect(purl.toString()).toBe('pkg:npm/lodash@4.17.21#lib/index.js')
    })

    it('should parse complex purl without pkg: prefix', () => {
      const purl = PackageURL.fromString(
        'maven/com.fasterxml.jackson.core/jackson-databind@2.13.0?classifier=sources#META-INF/MANIFEST.MF',
      )
      expect(purl.type).toBe('maven')
      expect(purl.namespace).toBe('com.fasterxml.jackson.core')
      expect(purl.name).toBe('jackson-databind')
      expect(purl.version).toBe('2.13.0')
      expect(purl.qualifiers).toStrictEqual({
        __proto__: null,
        classifier: 'sources',
      })
      expect(purl.subpath).toBe('META-INF/MANIFEST.MF')
      expect(purl.toString()).toBe(
        'pkg:maven/com.fasterxml.jackson.core/jackson-databind@2.13.0?classifier=sources#META-INF/MANIFEST.MF',
      )
    })

    it('should parse various package types without pkg: prefix', () => {
      const testCases = [
        'pypi/django@4.1.0',
        'gem/rails@7.0.0',
        'cargo/serde@1.0.0',
        'nuget/Newtonsoft.Json@13.0.1',
        'composer/symfony/console@6.0.0',
        'golang/github.com/gin-gonic/gin@v1.9.0',
      ]

      for (const testCase of testCases) {
        const purl = PackageURL.fromString(testCase)
        const withPkgPrefix = PackageURL.fromString(`pkg:${testCase}`)

        expect(purl.toString()).toBe(withPkgPrefix.toString())
        expect(purl.type).toBe(withPkgPrefix.type)
        expect(purl.namespace).toBe(withPkgPrefix.namespace)
        expect(purl.name).toBe(withPkgPrefix.name)
        expect(purl.version).toBe(withPkgPrefix.version)
      }
    })

    it('should handle encoded components without pkg: prefix', () => {
      const purl = PackageURL.fromString(
        'type/name%23space/na%23me@ver%23sion?foo=bar%23baz#sub%23path',
      )
      expect(purl.type).toBe('type')
      expect(purl.namespace).toBe('name#space')
      expect(purl.name).toBe('na#me')
      expect(purl.version).toBe('ver#sion')
      expect(purl.qualifiers).toStrictEqual({
        __proto__: null,
        foo: 'bar#baz',
      })
      expect(purl.subpath).toBe('sub#path')
      expect(purl.toString()).toBe(
        'pkg:type/name%23space/na%23me@ver%23sion?foo=bar%23baz#sub%23path',
      )
    })

    it('should handle edge cases without pkg: prefix', () => {
      // Type only (doesn't look like purl pattern, so should fail with missing pkg scheme)
      expect(() => PackageURL.fromString('type')).toThrow(
        /missing required "pkg" scheme/,
      )

      // Empty string (should still fail)
      expect(() => PackageURL.fromString('')).toThrow()

      // Type with name only
      const purl1 = PackageURL.fromString('npm/lodash')
      expect(purl1.type).toBe('npm')
      expect(purl1.name).toBe('lodash')
      expect(purl1.version).toBe(undefined)
    })

    it('should preserve original behavior for strings already starting with pkg:', () => {
      const purl1 = PackageURL.fromString('pkg:npm/lodash@4.17.21')
      const purl2 = PackageURL.fromString('npm/lodash@4.17.21')

      expect(purl1.toString()).toBe(purl2.toString())
      expect(purl1.type).toBe(purl2.type)
      expect(purl1.name).toBe(purl2.name)
      expect(purl1.version).toBe(purl2.version)
    })
  })

  describe('Comparison methods', () => {
    it('should compare PURLs for equality using equals instance method', () => {
      const purl1 = PackageURL.fromString('pkg:npm/lodash@4.17.21')
      const purl2 = PackageURL.fromString('pkg:npm/lodash@4.17.21')
      const purl3 = PackageURL.fromString('pkg:npm/lodash@4.17.20')

      expect(purl1.equals(purl2)).toBe(true)
      expect(purl1.equals(purl3)).toBe(false)
    })

    it('should compare PURLs for equality using static equals method', () => {
      const purl1 = PackageURL.fromString('pkg:npm/lodash@4.17.21')
      const purl2 = PackageURL.fromString('pkg:npm/lodash@4.17.21')
      const purl3 = PackageURL.fromString('pkg:npm/lodash@4.17.20')

      expect(PackageURL.equals(purl1, purl2)).toBe(true)
      expect(PackageURL.equals(purl1, purl3)).toBe(false)
    })

    it('should handle equality with different components', () => {
      const purl1 = PackageURL.fromString('pkg:npm/@babel/core@7.0.0')
      const purl2 = PackageURL.fromString('pkg:npm/@babel/core@7.0.0')
      const purl3 = PackageURL.fromString('pkg:npm/babel-core@7.0.0')

      expect(purl1.equals(purl2)).toBe(true)
      expect(purl1.equals(purl3)).toBe(false)
    })

    it('should compare PURLs for sorting using compare instance method', () => {
      const purl1 = PackageURL.fromString('pkg:npm/a@1.0.0')
      const purl2 = PackageURL.fromString('pkg:npm/b@1.0.0')
      const purl3 = PackageURL.fromString('pkg:npm/a@1.0.0')

      expect(purl1.compare(purl2)).toBe(-1)
      expect(purl2.compare(purl1)).toBe(1)
      expect(purl1.compare(purl3)).toBe(0)
    })

    it('should compare PURLs for sorting using static compare method', () => {
      const purl1 = PackageURL.fromString('pkg:npm/a@1.0.0')
      const purl2 = PackageURL.fromString('pkg:npm/b@1.0.0')
      const purl3 = PackageURL.fromString('pkg:npm/a@1.0.0')

      expect(PackageURL.compare(purl1, purl2)).toBe(-1)
      expect(PackageURL.compare(purl2, purl1)).toBe(1)
      expect(PackageURL.compare(purl1, purl3)).toBe(0)
    })

    it('should sort array of PURLs correctly', () => {
      const purls = [
        PackageURL.fromString('pkg:npm/z@1.0.0'),
        PackageURL.fromString('pkg:npm/a@1.0.0'),
        PackageURL.fromString('pkg:npm/m@1.0.0'),
      ]

      purls.sort((a, b) => a.compare(b))

      expect(purls[0]?.name).toBe('a')
      expect(purls[1]?.name).toBe('m')
      expect(purls[2]?.name).toBe('z')
    })
  })

  describe('fromNpm', () => {
    it('should parse npm package without version', () => {
      const purl = PackageURL.fromNpm('lodash')
      expect(purl.type).toBe('npm')
      expect(purl.name).toBe('lodash')
      expect(purl.namespace).toBe(undefined)
      expect(purl.version).toBe(undefined)
    })

    it('should parse npm package with version', () => {
      const purl = PackageURL.fromNpm('lodash@4.17.21')
      expect(purl.type).toBe('npm')
      expect(purl.name).toBe('lodash')
      expect(purl.version).toBe('4.17.21')
    })

    it('should parse scoped npm package without version', () => {
      const purl = PackageURL.fromNpm('@babel/core')
      expect(purl.type).toBe('npm')
      expect(purl.namespace).toBe('@babel')
      expect(purl.name).toBe('core')
      expect(purl.version).toBe(undefined)
    })

    it('should parse scoped npm package with version', () => {
      const purl = PackageURL.fromNpm('@babel/core@7.20.0')
      expect(purl.type).toBe('npm')
      expect(purl.namespace).toBe('@babel')
      expect(purl.name).toBe('core')
      expect(purl.version).toBe('7.20.0')
    })

    it('should strip caret version prefix', () => {
      const purl = PackageURL.fromNpm('lodash@^4.17.21')
      expect(purl.version).toBe('4.17.21')
    })

    it('should strip tilde version prefix', () => {
      const purl = PackageURL.fromNpm('lodash@~4.17.21')
      expect(purl.version).toBe('4.17.21')
    })

    it('should strip >= version prefix', () => {
      const purl = PackageURL.fromNpm('lodash@>=4.17.21')
      expect(purl.version).toBe('4.17.21')
    })

    it('should handle version ranges by taking first version', () => {
      const purl = PackageURL.fromNpm('lodash@1.0.0 - 2.0.0')
      expect(purl.version).toBe('1.0.0')
    })

    it('should support dist-tags (passed through as version)', () => {
      const purl = PackageURL.fromNpm('react@latest')
      expect(purl.type).toBe('npm')
      expect(purl.name).toBe('react')
      expect(purl.version).toBe('latest')
    })

    it('should support dist-tags for scoped packages', () => {
      const purl = PackageURL.fromNpm('@babel/core@next')
      expect(purl.type).toBe('npm')
      expect(purl.namespace).toBe('@babel')
      expect(purl.name).toBe('core')
      expect(purl.version).toBe('next')
    })

    it('should support common dist-tags', () => {
      expect(PackageURL.fromNpm('lodash@latest').version).toBe('latest')
      expect(PackageURL.fromNpm('lodash@next').version).toBe('next')
      expect(PackageURL.fromNpm('lodash@beta').version).toBe('beta')
      expect(PackageURL.fromNpm('lodash@canary').version).toBe('canary')
    })

    it('should reject non-string input', () => {
      expect(() => PackageURL.fromNpm(null as unknown as string)).toThrow(
        'npm package specifier string is required',
      )
      expect(() => PackageURL.fromNpm(123 as unknown as string)).toThrow(
        'npm package specifier string is required',
      )
    })

    it('should reject empty string', () => {
      expect(() => PackageURL.fromNpm('')).toThrow(
        'npm package specifier cannot be empty',
      )
      expect(() => PackageURL.fromNpm('  ')).toThrow(
        'npm package specifier cannot be empty',
      )
    })

    it('should reject invalid scoped package format', () => {
      expect(() => PackageURL.fromNpm('@babel')).toThrow(
        'Invalid scoped package specifier',
      )
    })
  })

  describe('fromSpec', () => {
    it('should create PackageURL from npm specifier', () => {
      const purl = PackageURL.fromSpec('npm', 'lodash@4.17.21')
      expect(purl.type).toBe('npm')
      expect(purl.name).toBe('lodash')
      expect(purl.version).toBe('4.17.21')
      expect(purl.toString()).toBe('pkg:npm/lodash@4.17.21')
    })

    it('should create PackageURL from scoped npm specifier', () => {
      const purl = PackageURL.fromSpec('npm', '@babel/core@^7.0.0')
      expect(purl.type).toBe('npm')
      expect(purl.namespace).toBe('@babel')
      expect(purl.name).toBe('core')
      expect(purl.version).toBe('7.0.0')
      expect(purl.toString()).toBe('pkg:npm/%40babel/core@7.0.0')
    })

    it('should handle npm specifier without version', () => {
      const purl = PackageURL.fromSpec('npm', 'express')
      expect(purl.type).toBe('npm')
      expect(purl.name).toBe('express')
      expect(purl.version).toBe(undefined)
      expect(purl.toString()).toBe('pkg:npm/express')
    })

    it('should handle npm version ranges', () => {
      const purl1 = PackageURL.fromSpec('npm', 'lodash@>=1.0.0')
      expect(purl1.version).toBe('1.0.0')

      const purl2 = PackageURL.fromSpec('npm', 'lodash@~2.0.0')
      expect(purl2.version).toBe('2.0.0')

      const purl3 = PackageURL.fromSpec('npm', 'foo@1.0.0 - 2.0.0')
      expect(purl3.version).toBe('1.0.0')
    })

    it('should handle npm dist-tags', () => {
      const purl = PackageURL.fromSpec('npm', 'react@latest')
      expect(purl.type).toBe('npm')
      expect(purl.name).toBe('react')
      expect(purl.version).toBe('latest')
    })

    it('should throw for unsupported package types', () => {
      expect(() => PackageURL.fromSpec('pypi', 'django@4.0.0')).toThrow(
        'Unsupported package type: pypi. Currently supported: npm',
      )

      expect(() => PackageURL.fromSpec('maven', 'org.example:lib@1.0')).toThrow(
        'Unsupported package type: maven. Currently supported: npm',
      )

      expect(() => PackageURL.fromSpec('gem', 'rails@7.0.0')).toThrow(
        'Unsupported package type: gem. Currently supported: npm',
      )
    })

    it('should validate npm specifier format', () => {
      expect(() =>
        PackageURL.fromSpec('npm', null as unknown as string),
      ).toThrow('npm package specifier string is required')

      expect(() => PackageURL.fromSpec('npm', '')).toThrow(
        'npm package specifier cannot be empty',
      )

      expect(() => PackageURL.fromSpec('npm', '@babel')).toThrow(
        'Invalid scoped package specifier',
      )
    })

    it('should produce same result as fromNpm for npm packages', () => {
      const spec1 = PackageURL.fromSpec('npm', 'lodash@4.17.21')
      const spec2 = PackageURL.fromNpm('lodash@4.17.21')
      expect(spec1.toString()).toBe(spec2.toString())

      const spec3 = PackageURL.fromSpec('npm', '@babel/core@^7.0.0')
      const spec4 = PackageURL.fromNpm('@babel/core@^7.0.0')
      expect(spec3.toString()).toBe(spec4.toString())
    })
  })

  describe('Path normalization', () => {
    it('should strip leading slashes from subpath with filtered segments', () => {
      // When segments like ".." are filtered, the remaining path should not have a leading slash
      // Should be "abc", not "/abc"
      const purl = new PackageURL(
        'npm',
        undefined,
        'foo',
        '1.0.0',
        undefined,
        '../abc',
      )
      expect(purl.subpath).toBe('abc')
    })

    it('should strip leading slashes from subpath with only dots', () => {
      const purl = new PackageURL(
        'npm',
        undefined,
        'foo',
        '1.0.0',
        undefined,
        './../abc',
      )
      expect(purl.subpath).toBe('abc')
    })

    it('should handle subpath with multiple filtered segments', () => {
      const purl = new PackageURL(
        'npm',
        undefined,
        'foo',
        '1.0.0',
        undefined,
        '../../abc/def',
      )
      expect(purl.subpath).toBe('abc/def')
    })
  })

  describe('Input validation', () => {
    // JSON security tests moved to package-url-json-security.test.mts
    // for better organization and to avoid duplication

    it('should reject package URLs exceeding maximum length', () => {
      const longUrl = `pkg:npm/${'x'.repeat(4090)}`
      expect(() => PackageURL.fromString(longUrl)).toThrow(
        'Package URL exceeds maximum length of 4096 characters',
      )
    })

    it('should handle bounded regex patterns without ReDoS', () => {
      // These used to be potential ReDoS vectors with unbounded quantifiers.
      const longScheme = `${'a'.repeat(300)}://`
      const longType = `${'a'.repeat(300)}/`

      // Should not hang with bounded patterns.
      expect(() => PackageURL.fromString(longScheme)).toThrow()
      expect(() => PackageURL.fromString(longType)).toThrow()
    })
  })
})
