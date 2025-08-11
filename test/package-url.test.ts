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

import path from 'node:path'

import { glob } from 'fast-glob'
import { describe, expect, it } from 'vitest'

import { readJson } from '@socketsecurity/registry/lib/fs'
import {
  isObject,
  toSortedObjectFromEntries
} from '@socketsecurity/registry/lib/objects'

import type { TestAPI } from 'vitest'

const npmBuiltinNames = require('../data/npm/builtin-names.json')
const npmLegacyNames = require('../data/npm/legacy-names.json')
const { PackageURL } = require('../src/package-url')

function getNpmId(purl) {
  const { name, namespace } = purl
  return `${namespace?.length > 0 ? `${namespace}/` : ''}${name}`
}

function toUrlSearchParams(search) {
  const searchParams = new URLSearchParams()
  const entries = search.split('&')
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const pairs = entries[i].split('=')
    const value = decodeURIComponent(pairs.at(1) ?? '')
    searchParams.append(pairs[0], value)
  }
  return searchParams
}

describe('PackageURL', () => {
  describe('KnownQualifierNames', () => {
    describe('check access', () => {
      ;[
        ['RepositoryUrl', 'repository_url'],
        ['DownloadUrl', 'download_url'],
        ['VcsUrl', 'vcs_url'],
        ['FileName', 'file_name'],
        ['Checksum', 'checksum']
      ].forEach(function ([name, expectedValue]) {
        it(`maps: ${name} => ${expectedValue}`, () => {
          expect(PackageURL.KnownQualifierNames[name]).toBe(expectedValue)
        })
      })
    })

    it('readonly: cannot be written', () => {
      expect(() => {
        PackageURL.KnownQualifierNames = { foo: 'bar' }
      }).toThrow(TypeError)
      expect(PackageURL.KnownQualifierNames).not.toStrictEqual({
        foo: 'bar'
      })
    })

    it('frozen: cannot be modified', () => {
      expect(() => {
        PackageURL.KnownQualifierNames.foo = 'bar'
      }).toThrow(TypeError)
      expect(PackageURL.KnownQualifierNames.foo).toBe(undefined)
    })
  })

  describe('constructor', () => {
    const paramMap = {
      type: 0,
      namespace: 1,
      name: 2,
      version: 3,
      qualifiers: 4,
      subpath: 5
    }

    const createArgs = (paramName, value) => {
      const args = [
        'type',
        'namespace',
        'name',
        'version',
        undefined,
        'subpath'
      ]
      args[paramMap[paramName]] = value
      return args
    }

    it('should validate required params', () => {
      // eslint-disable-next-line unicorn/consistent-function-scoping
      function testValid(paramName) {
        const paramIndex = paramMap[paramName]
        const args = createArgs(paramName, paramName)
        const message = JSON.stringify(args[paramIndex])
        try {
          // eslint-disable-next-line no-new
          new PackageURL(...args)
          expect(true, message)
        } catch {
          expect(false, message)
        }
      }

      // eslint-disable-next-line unicorn/consistent-function-scoping
      function testInvalid(paramName) {
        const paramIndex = paramMap[paramName]
        ;[
          createArgs(paramName, 0),
          createArgs(paramName, false),
          createArgs(paramName, 1),
          createArgs(paramName, true),
          createArgs(paramName, {}),
          createArgs(paramName, null),
          createArgs(paramName, undefined),
          createArgs(paramName, '')
        ].forEach(args => {
          const message = JSON.stringify(args[paramIndex])
          try {
            // eslint-disable-next-line no-new
            new PackageURL(...args)
            expect(false, message)
          } catch {
            expect(true, message)
          }
        })
      }

      for (const paramName of ['type', 'name']) {
        testValid(paramName)
        testInvalid(paramName)
      }
    })

    it('should validate string params', () => {
      // eslint-disable-next-line unicorn/consistent-function-scoping
      function testValid(paramName) {
        const paramIndex = paramMap[paramName]
        ;[
          createArgs(paramName, paramName),
          createArgs(paramName, null),
          createArgs(paramName, undefined),
          createArgs(paramName, '')
        ].forEach(args => {
          const message = JSON.stringify(args[paramIndex])
          try {
            // eslint-disable-next-line no-new
            new PackageURL(...args)
            expect(true, message)
          } catch {
            expect(false, message)
          }
        })
      }

      // eslint-disable-next-line unicorn/consistent-function-scoping
      function testInvalid(paramName) {
        const paramIndex = paramMap[paramName]
        ;[
          createArgs(paramName, 0),
          createArgs(paramName, false),
          createArgs(paramName, 1),
          createArgs(paramName, true),
          createArgs(paramName, {})
        ].forEach(args => {
          const message = JSON.stringify(args[paramIndex])
          try {
            // eslint-disable-next-line no-new
            new PackageURL(...args)
            expect(false, message)
          } catch {
            expect(true, message)
          }
        })
      }

      for (const paramName of ['namespace', 'version', 'subpath']) {
        testValid(paramName)
        testInvalid(paramName)
      }
    })

    it('should not decode params', () => {
      expect(new PackageURL('type', '%21', 'name').toString()).toBe(
        'pkg:type/%2521/name'
      )
      expect(new PackageURL('type', 'namespace', '%21').toString()).toBe(
        'pkg:type/namespace/%2521'
      )
      expect(
        new PackageURL('type', 'namespace', 'name', '%21').toString()
      ).toBe('pkg:type/namespace/name@%2521')
      expect(
        new PackageURL('type', 'namespace', 'name', '1.0', {
          a: '%21'
        }).toString()
      ).toBe('pkg:type/namespace/name@1.0?a=%2521')
      expect(
        new PackageURL('type', 'namespace', 'name', '1.0', 'a=%2521').toString()
      ).toBe('pkg:type/namespace/name@1.0?a=%2521')
      expect(
        new PackageURL(
          'type',
          'namespace',
          'name',
          '1.0',
          null,
          '%21'
        ).toString()
      ).toBe('pkg:type/namespace/name@1.0#%2521')
    })
  })

  describe('toString()', () => {
    it('type is validated', () => {
      ;['ty#pe', 'ty@pe', 'ty/pe', '1type'].forEach(type => {
        expect(() => new PackageURL(type, undefined, 'name')).toThrow(
          /contains an illegal character|cannot start with a number/
        )
      })
    })

    it('encode #', () => {
      /* The # is a delimiter between url and subpath. */
      const purl = new PackageURL(
        'type',
        'name#space',
        'na#me',
        'ver#sion',
        { foo: 'bar#baz' },
        'sub#path'
      )
      expect(purl.toString()).toBe(
        'pkg:type/name%23space/na%23me@ver%23sion?foo=bar%23baz#sub%23path'
      )
    })

    it('encode @', () => {
      /* The @ is a delimiter between package name and version. */
      const purl = new PackageURL(
        'type',
        'name@space',
        'na@me',
        'ver@sion',
        { foo: 'bar@baz' },
        'sub@path'
      )
      expect(purl.toString()).toBe(
        'pkg:type/name%40space/na%40me@ver%40sion?foo=bar%40baz#sub%40path'
      )
    })

    it('path components encode /', () => {
      /* only namespace is allowed to have multiple segments separated by `/`` */
      const purl = new PackageURL('type', 'namespace1/namespace2', 'na/me')
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
          'sha512:b9c27369720d948829a98118e9a35fd09d9018711e30dc2df5f8ae85bb19b2ade4679351c4d96768451ee9e841e5f5a36114a9ef98f4fe5256a5f4ca981736a0'
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
        vcs_url: 'git+https://github.com/package-url/packageurl-js.git'
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
        'pkg:type/namespace1/namespace2/na%2Fme'
      )
      expect(purl.type).toBe('type')
      expect(purl.namespace).toBe('namespace1/namespace2')
      expect(purl.name).toBe('na/me')
    })

    it('encoded #', () => {
      const purl = PackageURL.fromString(
        'pkg:type/name%23space/na%23me@ver%23sion?foo=bar%23baz#sub%23path'
      )
      expect(purl.type).toBe('type')
      expect(purl.namespace).toBe('name#space')
      expect(purl.name).toBe('na#me')
      expect(purl.version).toBe('ver#sion')
      expect(purl.qualifiers).toStrictEqual({
        __proto__: null,
        foo: 'bar#baz'
      })
      expect(purl.subpath).toBe('sub#path')
    })

    it('encoded @', () => {
      const purl = PackageURL.fromString(
        'pkg:type/name%40space/na%40me@ver%40sion?foo=bar%40baz#sub%40path'
      )
      expect(purl.type).toBe('type')
      expect(purl.namespace).toBe('name@space')
      expect(purl.name).toBe('na@me')
      expect(purl.version).toBe('ver@sion')
      expect(purl.qualifiers).toStrictEqual({
        __proto__: null,
        foo: 'bar@baz'
      })
      expect(purl.subpath).toBe('sub@path')
    })

    it('should error on decode failures', () => {
      expect(() => PackageURL.fromString('pkg:type/100%/name')).toThrow(
        /unable to decode "namespace" component/
      )
      expect(() => PackageURL.fromString('pkg:type/namespace/100%')).toThrow(
        /unable to decode "name" component/
      )
      expect(() =>
        PackageURL.fromString('pkg:type/namespace/name@100%')
      ).toThrow(/unable to decode "version" component/)
      expect(() =>
        PackageURL.fromString('pkg:type/namespace/name@1.0?a=100%')
      ).toThrow(/unable to decode "qualifiers" component/)
      expect(() =>
        PackageURL.fromString('pkg:type/namespace/name@1.0#100%')
      ).toThrow(/unable to decode "subpath" component/)
    })
  })

  describe('test-suite-data', async () => {
    const TEST_FILES = (
      await Promise.all(
        (
          await glob(['**/**.json'], {
            absolute: true,
            cwd: path.join(__dirname, 'data')
          })
        ).map(p => readJson(p))
      )
    )
      .filter(Boolean)
      .flatMap(o => o.tests ?? [])

    for (const obj of TEST_FILES) {
      const { expected_failure, expected_output, test_type } = obj

      const inputObj = isObject(obj.input) ? obj.input : undefined

      const inputStr = typeof obj.input === 'string' ? obj.input : undefined

      if (!inputObj && !inputStr) {
        continue
      }

      const expectedObj = isObject(expected_output)
        ? expected_output
        : undefined

      const expectedStr =
        typeof expected_output === 'string' ? expected_output : undefined

      if (!expectedObj && !expectedStr) {
        continue
      }

      describe(obj.description, (context: TestAPI) => {
        if (expected_failure) {
          if (test_type === 'parse' && inputStr) {
            it(`should not be possible to parse invalid ${expectedObj?.type ?? 'type'} PackageURLs`, () => {
              expect(() => PackageURL.fromString(inputStr)).toThrow(
                /missing the required|Invalid purl/
              )
            })
          }
          if (test_type === 'build' && inputObj) {
            it(`should not be possible to create invalid ${inputObj.type ?? 'type'} PackageURLs`, () => {
              expect(
                () =>
                  new PackageURL(
                    inputObj.type,
                    inputObj.namespace,
                    inputObj.name,
                    inputObj.version,
                    inputObj.qualifiers,
                    inputObj.subpath
                  )
              ).toThrow(/is a required|Invalid purl/)
            })
          }
        } else if (test_type === 'parse' && inputStr && expectedObj) {
          it(`should be able to parse valid ${expectedObj.type ?? 'type'} PackageURLs`, () => {
            const purl = PackageURL.fromString(inputStr)
            expect(purl.type).toBe(expectedObj.type)
            expect(purl.name).toBe(expectedObj.name)
            expect(purl.namespace).toBe(expectedObj.namespace ?? undefined)
            expect(purl.version).toBe(expectedObj.version ?? undefined)
            expect(purl.qualifiers).toStrictEqual(
              expectedObj.qualifiers
                ? { __proto__: null, ...expectedObj.qualifiers }
                : undefined
            )
            expect(purl.subpath).toBe(expectedObj.subpath ?? undefined)
          })
        } else if (test_type === 'build' && inputObj && expectedStr) {
          it(`should be able to convert valid ${inputObj.type ?? 'type'} PackageURLs to a string`, () => {
            const purl = new PackageURL(
              inputObj.type,
              inputObj.namespace,
              inputObj.name,
              inputObj.version,
              inputObj.qualifiers,
              inputObj.subpath
            )
            const purlToStr = purl.toString()
            if (purl.qualifiers) {
              const markIndex = expectedStr.indexOf('?')
              const beforeMarkToStr = purlToStr.slice(0, markIndex)
              const beforeExpectedStr = expectedStr.slice(0, markIndex)
              expect(beforeMarkToStr).toBe(beforeExpectedStr)

              const afterMarkToStr = purlToStr.slice(markIndex + 1)
              const afterExpectedStr = expectedStr.slice(markIndex + 1)
              const actualParams = toSortedObjectFromEntries(
                toUrlSearchParams(afterMarkToStr).entries()
              )
              const expectedParams = toSortedObjectFromEntries(
                toUrlSearchParams(afterExpectedStr).entries()
              )
              expect(actualParams).toStrictEqual(expectedParams)
            } else {
              expect(purlToStr).toBe(expectedStr)
            }
          })
        } else {
          context.skip('No test found')
        }
      })
    }
  })

  describe('npm', () => {
    it("should allow legacy names to be mixed case, match a builtin, or contain ~'!()* characters", () => {
      for (const legacyName of npmLegacyNames) {
        let purl
        expect(() => {
          const parts = legacyName.split('/')
          const namespace = parts.length > 1 ? parts[0] : ''
          const name = parts.at(-1)
          purl = new PackageURL('npm', namespace, name)
        }).not.toThrow()
        const id = purl ? getNpmId(purl) : ''
        const isBuiltin = npmBuiltinNames.includes(id)
        const isMixedCased = /[A-Z]/.test(id)
        const containsIllegalCharacters = /[~'!()*]/.test(id)
        expect(
          isBuiltin || isMixedCased || containsIllegalCharacters,
          `assert for ${legacyName}`
        )
      }
    })
    it('should not allow non-legacy builtin names', () => {
      for (const builtinName of npmBuiltinNames) {
        if (!npmLegacyNames.includes(builtinName)) {
          expect(() => {
            const parts = builtinName.split('/')
            const namespace = parts.length > 1 ? parts[0] : ''
            const name = parts.at(-1)
            // eslint-disable-next-line no-new
            new PackageURL('npm', namespace, name)
          }, `assert for ${builtinName}`).toThrow()
        }
      }
    })
  })

  describe('pub', () => {
    it('should normalize dashes to underscores', () => {
      const purlWithDashes = new PackageURL(
        'pub',
        '',
        'flutter-downloader',
        '1.0.0'
      )
      expect(purlWithDashes.toString()).toBe('pkg:pub/flutter_downloader@1.0.0')
    })
  })

  describe('pypi', () => {
    it('should handle pypi package-urls per the purl-spec', () => {
      const purlMixedCasing = PackageURL.fromString('pkg:pypi/PYYaml@5.3.0')
      expect(purlMixedCasing.toString()).toBe('pkg:pypi/pyyaml@5.3.0')
      const purlWithUnderscore = PackageURL.fromString(
        'pkg:pypi/typing_extensions_blah@1.0.0'
      )
      expect(purlWithUnderscore.toString()).toBe(
        'pkg:pypi/typing-extensions-blah@1.0.0'
      )
    })
  })
})
