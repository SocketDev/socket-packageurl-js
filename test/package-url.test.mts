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
 * @file Core unit tests for PackageURL class. Tests constructor validation,
 *   known qualifier names immutability, isValid, fromUrl, the with* immutable
 *   copy methods, and toSpec. String round-trip (toString/fromString) coverage
 *   lives in package-url-string.test.mts.
 */
import { describe, expect, it } from 'vitest'

import { PackageURL } from '../src/package-url.mjs'
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
      expect(PackageURL.isValid(undefined)).toBe(false)
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
        'lodash@4.17.21?repository_url=https:%2F%2Fexample.com',
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

    // oxlint-disable-next-line socket/no-vitest-empty-test -- assertions run inside the testValidParam/testInvalidParam helpers.
    it('should validate required params', () => {
      // Tests that type and name are required (various invalid inputs)

      for (const paramName of ['type', 'name']) {
        testValidParam(paramName, paramMap, createArgs)
        testInvalidParam(paramName, paramMap, createArgs)
      }
    })

    // oxlint-disable-next-line socket/no-vitest-empty-test -- assertions run inside the testValidStringParam/testInvalidStringParam helpers.
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
          qualifiers: undefined,
          subpath: '%21',
          version: '1.0',
        }).toString(),
      ).toBe('pkg:type/namespace/name@1.0#%2521')
    })
  })
})
