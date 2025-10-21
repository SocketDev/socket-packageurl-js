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

import { describe, expect, it } from 'vitest'

import {
  encodeComponent,
  encodeNamespace,
  encodeQualifierParam,
  encodeQualifiers,
  encodeSubpath,
  encodeVersion,
} from '../src/encode.js'
import { PurlError, formatPurlErrorMessage } from '../src/error.js'
import {
  normalizeName,
  normalizeNamespace,
  normalizeQualifiers,
  normalizeSubpath,
  normalizeType,
  normalizeVersion,
} from '../src/normalize.js'
import { recursiveFreeze } from '../src/objects.js'
import { PackageURL } from '../src/package-url.js'
import {
  PurlComponent,
  PurlComponentEncoder,
  PurlComponentStringNormalizer,
  PurlComponentValidator,
  componentComparator,
  componentSortOrder,
} from '../src/purl-component.js'
import { PurlQualifierNames } from '../src/purl-qualifier-names.js'
import { PurlType } from '../src/purl-type.js'
import {
  validateEmptyByType,
  validateName,
  validateNamespace,
  validateQualifierKey,
  validateQualifiers,
  validateRequired,
  validateRequiredByType,
  validateStartsWithoutNumber,
  validateStrings,
  validateSubpath,
  validateType,
  validateVersion,
} from '../src/validate.js'
import { createTestFunction, createTestPurl } from './utils/test-helpers.mjs'

describe('Edge cases and additional coverage', () => {
  describe('URL scheme handling', () => {
    it('should accept pkg:// with double slash and ignore the slashes', () => {
      const purl = PackageURL.fromString('pkg://type/namespace/name@1.0.0')
      expect(purl.type).toBe('type')
      expect(purl.namespace).toBe('namespace')
      expect(purl.name).toBe('name')
      expect(purl.version).toBe('1.0.0')
    })

    it('should reject non-pkg schemes', () => {
      expect(() => PackageURL.fromString('http://type/name')).toThrow(
        /missing required "pkg" scheme/,
      )
      expect(() => PackageURL.fromString('npm://type/name')).toThrow(
        /missing required "pkg" scheme/,
      )
    })

    it('should reject URLs with authority components', () => {
      expect(() =>
        PackageURL.fromString('pkg://user:pass@host:8080/type/name'),
      ).toThrow(/cannot contain a "user:pass@host:port"/)
      expect(() => PackageURL.fromString('pkg://user@host/type/name')).toThrow(
        /cannot contain a "user:pass@host:port"/,
      )
    })

    it('should reject URLs with password auth component', () => {
      // Test password-only auth (empty username, non-empty password)
      expect(() => PackageURL.fromString('pkg://:password@type/name')).toThrow(
        /cannot contain a "user:pass@host:port"/,
      )
    })

    it('should reject all combinations of username and password auth', () => {
      // Test username only (already covered but for completeness)
      expect(() => PackageURL.fromString('pkg://user@type/name')).toThrow(
        /cannot contain a "user:pass@host:port"/,
      )

      // Test password only (already covered but for completeness)
      expect(() => PackageURL.fromString('pkg://:password@type/name')).toThrow(
        /cannot contain a "user:pass@host:port"/,
      )

      // Test both username and password (full auth credentials)
      expect(() =>
        PackageURL.fromString('pkg://user:password@type/name'),
      ).toThrow(/cannot contain a "user:pass@host:port"/)

      // Test with host component too (complete authority format)
      expect(() =>
        PackageURL.fromString('pkg://user:pass@host:8080/type/name'),
      ).toThrow(/cannot contain a "user:pass@host:port"/)
    })

    it('should handle URL parsing failures gracefully', () => {
      // Invalid URL with malformed brackets that causes URL constructor to throw
      // This triggers the catch block in the URL parsing code
      // Tests c8 ignore branch in package-url.js for URL parsing failures
      expect(() => PackageURL.fromString('pkg://[invalid')).toThrow(
        /failed to parse as URL/,
      )
    })

    it('should reject malformed URLs without colon after scheme', () => {
      // Tests edge case where scheme is present but missing colon separator
      expect(() => PackageURL.fromString('pkg')).toThrow(
        /missing required "pkg" scheme/,
      )
    })

    it('should handle type-only purl without namespace or name', () => {
      // Tests minimal purl with only type component (all other components undefined)
      const result = PackageURL.parseString('pkg:type')
      expect(result[0]).toBe('type')
      expect(result[1]).toBe(undefined)
      expect(result[2]).toBe(undefined)
      expect(result[3]).toBe(undefined)
      expect(result[4]).toBe(undefined)
      expect(result[5]).toBe(undefined)
    })
  })

  describe('Component validation', () => {
    it('should handle empty purl strings', () => {
      // Tests edge case for completely empty input (all components undefined)
      const result = PackageURL.parseString('')
      expect(result).toStrictEqual([
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      ])
    })

    it('should handle whitespace-only purl strings', () => {
      // Tests whitespace trimming behavior (treats as empty string)
      const result = PackageURL.parseString('   ')
      expect(result).toStrictEqual([
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      ])
    })

    it('should handle type-only purls', () => {
      const result = PackageURL.parseString('pkg:type')
      expect(result[0]).toBe('type')
      expect(result[1]).toBe(undefined)
      expect(result[2]).toBe(undefined)
    })

    it('should reject invalid URL strings', () => {
      expect(() => PackageURL.fromString('not a url')).toThrow(
        /missing required "pkg" scheme/,
      )
      expect(() => PackageURL.fromString('pkg:')).toThrow(
        /"type" is a required component/,
      )
    })

    it('should handle types with uppercase letters (gets normalized)', () => {
      // Tests type normalization to lowercase (required by spec)
      const purl = createTestPurl('Type', 'name')
      expect(purl.type).toBe('type')
    })

    it('should handle very long component values', () => {
      // Test with maximum allowed lengths for components.
      // Max namespace length.
      const maxNamespace = 'a'.repeat(512)
      // Max name length.
      const maxName = 'b'.repeat(214)
      // Max version length.
      const maxVersion = 'c'.repeat(256)
      const purl = createTestPurl('type', maxName, {
        namespace: maxNamespace,
        version: maxVersion,
      })
      expect(purl.namespace).toBe(maxNamespace)
      expect(purl.name).toBe(maxName)
      expect(purl.version).toBe(maxVersion)

      // Test that exceeding limits throws errors.
      expect(() =>
        createTestPurl('type', 'name', { namespace: 'a'.repeat(513) }),
      ).toThrow('"namespace" exceeds maximum length of 512 characters')
      expect(() => createTestPurl('type', 'a'.repeat(215))).toThrow(
        '"name" exceeds maximum length of 214 characters',
      )
    })

    it('should preserve exact qualifier order in toString', () => {
      // Tests qualifier key sorting requirement (alphabetical order per spec)
      const purl = createTestPurl('type', 'name', {
        qualifiers: {
          a: 'first',
          m: 'middle',
          z: 'last',
        },
      })
      const str = purl.toString()
      const queryStart = str.indexOf('?')
      const queryPart = str.slice(queryStart + 1)
      expect(queryPart).toMatch(/^a=first&m=middle&z=last$/)
    })
  })

  describe('Special character handling', () => {
    it('should handle names with special URL characters', () => {
      // Tests encoding/decoding of special characters (roundtrip test)
      const specialChars = "!$&'()*+,;="
      const purl = createTestPurl('type', specialChars)
      const encoded = purl.toString()
      const decoded = PackageURL.fromString(encoded)
      expect(decoded.name).toBe(specialChars)
    })

    it('should handle percent-encoded components correctly', () => {
      // Tests URL decoding of percent-encoded values
      const purl = PackageURL.fromString('pkg:type/name%20with%20spaces')
      expect(purl.name).toBe('name with spaces')
    })

    it('should handle percent signs in input', () => {
      // Tests double encoding prevention (% becomes %25)
      const purl = createTestPurl('type', 'name%20')
      expect(purl.toString()).toBe('pkg:type/name%2520')
    })

    it('should handle Unicode characters', () => {
      // Tests UTF-8 encoding/decoding support (internationalization)
      const unicodeName = '测试包'
      const purl = createTestPurl('type', unicodeName)
      const encoded = purl.toString()
      const decoded = PackageURL.fromString(encoded)
      expect(decoded.name).toBe(unicodeName)
    })

    it('should handle plus signs in qualifiers', () => {
      // Tests that + is preserved in qualifiers (not converted to space)
      const purl = PackageURL.fromString('pkg:type/name?key=value+with+plus')
      expect(purl.qualifiers?.key).toBe('value+with+plus')
    })
  })

  describe('Version separator edge cases', () => {
    it('should not treat @ in namespace as version separator', () => {
      // Tests @ parsing logic (only last @ after name is version separator)
      const purl = PackageURL.fromString('pkg:type/@namespace/name@1.0')
      expect(purl.namespace).toBe('@namespace')
      expect(purl.name).toBe('name')
      expect(purl.version).toBe('1.0')
    })

    it('should handle multiple @ symbols correctly', () => {
      // Tests multiple @ handling (only last @ is version separator)
      const purl = PackageURL.fromString('pkg:type/namespace/name@1.0@beta')
      expect(purl.name).toBe('name@1.0')
      expect(purl.version).toBe('beta')
    })

    it('should handle npm packages with complex versions', () => {
      // Tests complex npm peer dependency version strings (pnpm format)
      const purlStr =
        'pkg:npm/next@14.2.10(react-dom@18.3.1(react@18.3.1))(react@18.3.1)'
      const purl = PackageURL.fromString(purlStr)
      expect(purl.name).toBe('next')
      expect(purl.version).toBe(
        '14.2.10(react-dom@18.3.1(react@18.3.1))(react@18.3.1)',
      )
    })

    it('should not treat @ preceded by / as version separator', () => {
      // Tests @ after / is part of name (npm scoped packages pattern)
      const purl = PackageURL.fromString('pkg:type/namespace/name/@version')
      expect(purl.namespace).toBe('namespace/name')
      expect(purl.name).toBe('@version')
      expect(purl.version).toBe(undefined)
    })
  })

  describe('Subpath handling', () => {
    it('should normalize subpath by removing leading slashes', () => {
      // Tests subpath normalization (leading slashes removed per spec)
      const purl1 = createTestPurl('type', 'name', {
        subpath: '/path/to/file',
      })
      const purl2 = createTestPurl('type', 'name', {
        subpath: 'path/to/file',
      })
      expect(purl1.subpath).toBe('path/to/file')
      expect(purl2.subpath).toBe('path/to/file')
    })

    it('should handle subpath with query-like strings', () => {
      // Tests that ? in subpath is encoded (not treated as qualifier separator)
      const purl = createTestPurl('type', 'name', {
        subpath: 'path?query=value',
      })
      expect(purl.subpath).toBe('path?query=value')
      expect(purl.toString()).toBe('pkg:type/name#path%3Fquery%3Dvalue')
    })

    it('should normalize empty subpath segments', () => {
      // Tests subpath normalization (consecutive slashes collapsed)
      const purl = createTestPurl('type', 'name', {
        subpath: 'path//to///file',
      })
      expect(purl.subpath).toBe('path/to/file')
    })
  })

  describe('Qualifier handling', () => {
    it('should handle empty qualifier values', () => {
      // Tests that qualifiers with empty values are omitted
      const purl = PackageURL.fromString('pkg:type/name?key=')
      expect(purl.qualifiers).toBe(undefined)
    })

    it('should handle qualifiers without values', () => {
      // Tests that qualifiers without = are omitted
      const purl = PackageURL.fromString('pkg:type/name?key')
      expect(purl.qualifiers).toBe(undefined)
    })

    it('should handle duplicate qualifier keys (last wins)', () => {
      // Tests duplicate key behavior (last value takes precedence)
      const purl = PackageURL.fromString('pkg:type/name?key=first&key=second')
      expect(purl.qualifiers?.key).toBe('second')
    })

    it('should normalize qualifier keys to lowercase', () => {
      // Tests qualifier key normalization (always lowercase per spec)
      const purl = createTestPurl('type', 'name', {
        qualifiers: {
          KEY: 'value',
        },
      })
      expect(purl.qualifiers).toStrictEqual({ __proto__: null, key: 'value' })
    })

    it('should handle qualifiers with special characters in values', () => {
      // Tests special character encoding in qualifier values
      const purl = PackageURL.fromString('pkg:type/name?key=%3D%26%3F%23')
      expect(purl.qualifiers?.key).toBe('=&?#')
    })

    it('should convert qualifier objects to URLSearchParams correctly', () => {
      // Tests qualifier serialization with multiple key-value pairs
      const qualifiers = {
        arch: 'x86_64',
        distro: 'ubuntu-20.04',
        epoch: '1',
      }
      const purl = createTestPurl('type', 'name', {
        qualifiers,
      })
      const str = purl.toString()
      expect(str).toContain('arch=x86_64')
      expect(str).toContain('distro=ubuntu-20.04')
      expect(str).toContain('epoch=1')
    })
  })

  describe('Type-specific normalizations', () => {
    it('should handle golang type with uppercase module names', () => {
      // Tests golang-specific behavior (case-sensitive modules)
      const purl = createTestPurl('golang', 'Module', {
        namespace: 'GitHub.com/User',
      })
      expect(purl.namespace).toBe('GitHub.com/User')
      expect(purl.name).toBe('Module')
    })

    it('should handle bitbucket namespace case sensitivity', () => {
      // Tests bitbucket-specific normalization (namespace to lowercase)
      const purl = createTestPurl('bitbucket', 'repo', {
        namespace: 'UserName',
      })
      expect(purl.namespace).toBe('username')
    })

    it('should handle github namespace case sensitivity', () => {
      // Tests github-specific normalization (namespace to lowercase)
      const purl = createTestPurl('github', 'repo', {
        namespace: 'UserName',
      })
      expect(purl.namespace).toBe('username')
    })
  })

  describe('Constructor parameter types', () => {
    it('should handle array as qualifiers (gets converted to undefined)', () => {
      // Tests qualifiers type checking (arrays treated as undefined)
      const purl = new PackageURL('type', null, 'name', null, [], undefined)
      expect(purl.qualifiers).toBe(undefined)
    })

    it('should handle function as parameter (should reject)', () => {
      // Tests parameter type validation (functions rejected)
      const testFn = () => {}
      expect(
        () =>
          new PackageURL(testFn, null, 'name', undefined, undefined, undefined),
      ).toThrow()
      expect(
        () =>
          new PackageURL(
            'type',
            testFn,
            'name',
            undefined,
            undefined,
            undefined,
          ),
      ).toThrow()
      expect(
        () =>
          new PackageURL('type', null, testFn, undefined, undefined, undefined),
      ).toThrow()
    })

    it('should handle symbols as parameters (should reject)', () => {
      // Tests parameter type validation (symbols rejected)
      const sym = Symbol('test')
      expect(
        () =>
          new PackageURL(sym, null, 'name', undefined, undefined, undefined),
      ).toThrow()
      expect(
        () =>
          new PackageURL('type', sym, 'name', undefined, undefined, undefined),
      ).toThrow()
      expect(
        () =>
          new PackageURL('type', null, sym, undefined, undefined, undefined),
      ).toThrow()
    })
  })

  describe('Round-trip consistency', () => {
    it('should maintain consistency through multiple parse/toString cycles', () => {
      // Tests idempotent roundtrip (parsing and serializing repeatedly)
      const original =
        'pkg:npm/@scope/package@1.0.0-beta.1?arch=x64#src/index.js'
      let purl = PackageURL.fromString(original)

      for (let i = 0; i < 5; i++) {
        const str = purl.toString()
        purl = PackageURL.fromString(str)
      }

      expect(purl.type).toBe('npm')
      expect(purl.namespace).toBe('@scope')
      expect(purl.name).toBe('package')
      expect(purl.version).toBe('1.0.0-beta.1')
      expect(purl.qualifiers).toStrictEqual({ __proto__: null, arch: 'x64' })
      expect(purl.subpath).toBe('src/index.js')
    })
  })

  describe('Error messages', () => {
    it('should provide clear error message for missing type', () => {
      // Tests error message clarity (type validation)
      expect(
        () => new PackageURL('', null, 'name', undefined, undefined, undefined),
      ).toThrow(/"type" is a required component/)
    })

    it('should provide clear error message for missing name', () => {
      // Tests error message clarity (name validation)
      expect(
        () => new PackageURL('type', null, '', undefined, undefined, undefined),
      ).toThrow(/"name" is a required component/)
    })

    it('should provide clear error message for non-string input to fromString', () => {
      // Tests fromString parameter validation
      expect(() => PackageURL.fromString(123)).toThrow(
        /purl string argument is required/,
      )
      expect(() => PackageURL.fromString(null)).toThrow(
        /purl string argument is required/,
      )
      expect(() => PackageURL.fromString(undefined)).toThrow(
        /purl string argument is required/,
      )
    })
  })

  describe('Prototype pollution prevention', () => {
    it('should handle __proto__ in qualifiers', () => {
      const purl = PackageURL.fromString('pkg:type/name?__proto__=polluted')

      expect(purl.qualifiers?.__proto__).toBe('polluted')
      expect((Object.prototype as any).polluted).toBe(undefined)
    })

    it('should have proper prototype for PackageURL instances', () => {
      const purl = createTestPurl('type', 'name')
      // Verify the instance is properly constructed with null prototype for security
      expect(Object.getPrototypeOf(purl)).toBe(PackageURL.prototype)
      expect(Object.getPrototypeOf(PackageURL.prototype)).toBe(null)
    })
  })

  describe('Memory and performance', () => {
    it('should handle large numbers of qualifiers', () => {
      const qualifiers = {}
      for (let i = 0; i < 100; i++) {
        ;(qualifiers as any)[`key${i}`] = `value${i}`
      }
      const purl = createTestPurl('type', 'name', {
        qualifiers,
      })
      expect(Object.keys(purl.qualifiers || {}).length).toBe(100)
    })

    it('should handle deeply nested namespace paths', () => {
      const deepNamespace = Array(50).fill('level').join('/')
      const purl = createTestPurl('type', 'name', {
        namespace: deepNamespace,
      })
      expect(purl.namespace).toBe(deepNamespace)
    })
  })

  describe('Additional coverage tests', () => {
    // Test error formatting edge cases using imports
    it.each([
      ['Error without period', 'Invalid purl: error without period'],
      [
        'Error with double period..',
        'Invalid purl: error with double period..',
      ],
      ['already lowercase', 'Invalid purl: already lowercase'],
      ['', 'Invalid purl: '],
    ])('should format error message "%s" correctly', (input, expected) => {
      try {
        throw new PurlError(input)
      } catch (e) {
        expect((e as Error).message).toBe(expected)
      }
    })

    // Test encode module functions
    it('should handle encodeQualifierParam with various inputs', () => {
      const purl1 = createTestPurl('type', 'name', {
        qualifiers: {
          'key-special': 'value with %20 encoded',
          'key-with-plus': 'value+plus',
          'key-with-spaces': 'value with spaces',
        },
      })
      const str1 = purl1.toString()
      expect(str1).toContain('key-with-spaces=value%20with%20spaces')
      expect(str1).toContain('key-with-plus=value%2Bplus')
    })

    // Test objects module - recursiveFreeze edge cases
    it.each([
      ['already frozen objects', { key: 'value' }],
      ['nested objects', { inner: { deep: 'value' } }],
      ['arrays', { arr: [1, 2, { nested: true }] }],
      ['mixed types', { str: 'test', num: 123, obj: { nested: true } }],
    ])('should handle recursiveFreeze with %s', (_description, qualifiers) => {
      const purl = new PackageURL(
        'type',
        null,
        'name',
        null,
        qualifiers,
        undefined,
      )
      expect(purl.qualifiers).toBeDefined()
      // Just verify the purl was created successfully and qualifiers exist
      expect(typeof purl.qualifiers).toBe('object')
    })

    // Test validation edge cases
    it('should handle validateRequiredByType with empty values', () => {
      // Test maven requiring namespace
      expect(() => {
        createTestPurl('maven', 'name', { namespace: '' })
      }).toThrow(/maven requires a "namespace" component/)
    })

    it('should handle names starting with numbers for certain types', () => {
      // Some types allow names starting with numbers
      const purl1 = createTestPurl('generic', '9name')
      expect(purl1.name).toBe('9name')

      // Test a different invalid npm name pattern
      expect(() => {
        createTestPurl('npm', '.invalid')
      }).toThrow()
    })

    // Test package-url.js specific lines
    it('should handle PackageURL with all null/undefined values', () => {
      const purl = createTestPurl('type', 'name')
      expect(purl.type).toBe('type')
      expect(purl.name).toBe('name')
      expect(purl.namespace).toBe(undefined)
      expect(purl.version).toBe(undefined)
    })

    it('should handle fromString with various edge cases', () => {
      // Test with only type and name
      const purl1 = PackageURL.fromString('pkg:type/name')
      expect(purl1.type).toBe('type')
      expect(purl1.name).toBe('name')

      // Test with empty qualifiers
      const purl2 = PackageURL.fromString('pkg:type/name?')
      expect(purl2.type).toBe('type')
      expect(purl2.name).toBe('name')
      expect(purl2.qualifiers).toBe(undefined)
    })

    // Test purl-type specific behaviors
    it('should handle swift type specifics', () => {
      const purl = createTestPurl('swift', 'swift-numerics', {
        namespace: 'github.com/apple',
        version: '1.0.0',
      })
      expect(purl.namespace).toBe('github.com/apple')
    })

    it('should handle hackage type validation', () => {
      const purl = createTestPurl('hackage', 'package-name', {
        namespace: null,
        version: '1.0.0',
      })
      expect(purl.type).toBe('hackage')
      expect(purl.namespace).toBe(null)
    })

    it('should handle huggingface model type', () => {
      const purl = createTestPurl('huggingface', 'model-name', {
        namespace: 'namespace',
        version: 'v1.0',
      })
      expect(purl.type).toBe('huggingface')
      expect(purl.namespace).toBe('namespace')
    })

    it('should handle mlflow model type', () => {
      const purl = createTestPurl('mlflow', 'model-name', {
        qualifiers: {
          model_uuid: '123-456',
          repository_url: 'https://example.com',
        },
        version: '1.0',
      })
      expect(purl.type).toBe('mlflow')
      expect(purl.qualifiers?.repository_url).toBe('https://example.com')
    })

    it('should handle qpkg type', () => {
      const purl = createTestPurl('qpkg', 'package', {
        qualifiers: {
          arch: 'x86_64',
        },
        version: '1.0',
      })
      expect(purl.type).toBe('qpkg')
      expect(purl.qualifiers?.arch).toBe('x86_64')
    })

    // Test index.js exports
    it('should export all expected modules from index.js', () => {
      // These are already imported at the top of the file
      expect(PackageURL).toBeDefined()
      expect(PurlComponent).toBeDefined()
      expect(PurlQualifierNames).toBeDefined()
      expect(PurlType).toBeDefined()
    })
  })

  describe('Coverage improvements', () => {
    // Test encode functions
    it('should handle encodeQualifierParam edge cases', () => {
      expect(encodeQualifierParam('')).toBe('')
      expect(encodeQualifierParam(null)).toBe('')
      expect(encodeQualifierParam(undefined)).toBe('')
      expect(encodeQualifierParam('value with spaces')).toContain('%20')
      expect(encodeQualifierParam('value+plus')).toContain('%2B')
    })

    // Test error formatting

    // Test recursiveFreeze edge cases
    it('should handle recursiveFreeze with various inputs', () => {
      // Already frozen object
      const frozen = Object.freeze({ a: 1 })
      expect(recursiveFreeze(frozen)).toBe(frozen)

      // Null and primitives
      expect(recursiveFreeze(null)).toBe(null)
      expect(recursiveFreeze(42)).toBe(42)
      expect(recursiveFreeze('string')).toBe('string')

      // Function with properties
      const fn: any = createTestFunction()
      ;(fn as any).prop = { nested: 'value' }
      const frozenFn = recursiveFreeze(fn)
      expect(Object.isFrozen(frozenFn)).toBe(true)
      expect(Object.isFrozen((frozenFn as any).prop)).toBe(true)

      // Arrays with nested objects
      const arr = [{ a: 1 }, [{ b: 2 }]]
      const frozenArr = recursiveFreeze(arr)
      expect(Object.isFrozen(frozenArr)).toBe(true)
      expect(Object.isFrozen(frozenArr[0])).toBe(true)
      expect(Object.isFrozen((frozenArr[1] as any)[0])).toBe(true)
    })

    // Test validation functions with throws parameter
    it.each([
      [
        'validateRequired',
        validateRequired,
        'field',
        null as unknown,
        '"field" is a required component',
        'value' as unknown,
      ],
      [
        'validateRequired empty string',
        validateRequired,
        'field',
        '' as unknown,
        '"field" is a required component',
        'value' as unknown,
      ],
      [
        'validateRequiredByType',
        (_field: string, value: unknown, opts: any) =>
          validateRequiredByType('npm', 'name', value, opts),
        'name',
        null as unknown,
        'npm requires a "name" component',
        'value' as unknown,
      ],
      [
        'validateRequiredByType empty string',
        (_field: string, value: unknown, opts: any) =>
          validateRequiredByType('npm', 'name', value, opts),
        'name',
        '' as unknown,
        'npm requires a "name" component',
        'value' as unknown,
      ],
      [
        'validateStartsWithoutNumber',
        validateStartsWithoutNumber,
        'field',
        '1test' as unknown,
        'field "1test" cannot start with a number',
        'test' as unknown,
      ],
      [
        'validateEmptyByType',
        (_field: string, value: unknown, opts: any) =>
          validateEmptyByType('swift', 'namespace', value, opts),
        'namespace',
        'not-empty' as unknown,
        /swift "namespace" component must be empty/,
        '' as unknown,
      ],
      [
        'validateName',
        (_field: string, value: unknown, opts: any) =>
          validateName(value, opts),
        'name',
        null as unknown,
        /"name" is a required component/,
        'valid' as unknown,
      ],
      [
        'validateNamespace',
        (_field: string, value: unknown, opts: any) =>
          validateNamespace(value, opts),
        'namespace',
        123 as unknown,
        /"namespace" must be a string/,
        'valid' as unknown,
      ],
      [
        'validateQualifierKey',
        (_field: string, value: unknown, opts: any) =>
          validateQualifierKey(value as string, opts),
        'key',
        'key!invalid' as unknown,
        /qualifier "key!invalid" contains an illegal character/,
        'validkey' as unknown,
      ],
      [
        'validateStrings',
        (field: string, value: unknown, opts: any) =>
          validateStrings(field, value, opts),
        'test',
        123 as unknown,
        /"test" must be a string/,
        'valid' as unknown,
      ],
      [
        'validateType',
        (_field: string, value: unknown, opts: any) =>
          validateType(value, opts),
        'type',
        'type$illegal' as unknown,
        /type "type\$illegal" contains an illegal character/,
        'validtype' as unknown,
      ],
      [
        'validateVersion',
        (_field: string, value: unknown, opts: any) =>
          validateVersion(value, opts),
        'version',
        123 as unknown,
        /"version" must be a string/,
        '1.0.0' as unknown,
      ],
    ])(
      'should support both option object and legacy boolean parameter for %s',
      (_name, validatorFn, field, invalidValue, errorMessage, validValue) => {
        // Test new API with { throws: true }
        expect(() =>
          validatorFn(field as string, invalidValue as any, { throws: true }),
        ).toThrow(errorMessage)
        // Test new API with { throws: false }
        expect(
          validatorFn(field as string, invalidValue as any, {
            throws: false,
          }),
        ).toBe(false)
        // Test with undefined parameter
        expect(
          validatorFn(field as string, invalidValue as any, undefined),
        ).toBe(false)
        expect(validatorFn(field as string, validValue as any, undefined)).toBe(
          true,
        )
        // Test legacy boolean parameter
        expect(validatorFn(field as string, invalidValue as any, false)).toBe(
          false,
        )
        expect(validatorFn(field as string, validValue as any, false)).toBe(
          true,
        )
        expect(() =>
          validatorFn(field as string, invalidValue as any, true),
        ).toThrow(errorMessage)
      },
    )

    it('should validate qualifiers with both option object and legacy boolean parameter', () => {
      // Test new API
      expect(validateQualifiers({ key: 'value' }, { throws: false })).toBe(true)
      expect(validateQualifiers(null, { throws: false })).toBe(true)
      expect(validateQualifiers([], { throws: false })).toBe(false)
      expect(() => validateQualifiers([], { throws: true })).toThrow(
        '"qualifiers" must be a plain object',
      )

      // Test with undefined parameter
      expect(validateQualifiers({ key: 'value' }, undefined)).toBe(true)
      expect(validateQualifiers(null, undefined)).toBe(true)
      expect(validateQualifiers([], undefined)).toBe(false)

      // Test legacy boolean parameter
      expect(validateQualifiers({ key: 'value' }, false)).toBe(true)
      expect(validateQualifiers([], false)).toBe(false)
      expect(() => validateQualifiers([], true)).toThrow(
        '"qualifiers" must be a plain object',
      )
    })

    // Test npm namespace validation non-throws mode
    it('should validate npm namespace without @ character in non-throws mode', () => {
      // Test purl-type.ts lines 428-429 - return false path
      const comp = { namespace: 'namespace', name: 'test' }
      const result = (PurlType.npm as any).validate(comp, false)
      expect(result).toBe(false)

      // Also verify throws mode works
      expect(() => (PurlType.npm as any).validate(comp, true)).toThrow(
        /npm "namespace" component must start with an "@" character/,
      )
    })

    // Test index.js exports
    it('should export PackageURL correctly from index.js', () => {
      // The index.js exports PackageURL
      expect(PackageURL).toBeDefined()

      // Test that it can create instances
      const purl = new PackageURL(
        'npm',
        '',
        'test',
        '1.0.0',
        undefined,
        undefined,
      )
      expect(purl.toString()).toBe('pkg:npm/test@1.0.0')
    })

    // Test mlflow type validation
    it('should validate mlflow namespace must be empty', () => {
      // mlflow requires empty namespace
      expect(
        () =>
          new PackageURL(
            'mlflow',
            'namespace',
            'model',
            '1.0.0',
            undefined,
            undefined,
          ),
      ).toThrow(/mlflow "namespace" component must be empty/)

      const validMlflow = new PackageURL(
        'mlflow',
        '',
        'model',
        '1.0.0',
        undefined,
        undefined,
      )
      expect(validMlflow.toString()).toBe('pkg:mlflow/model@1.0.0')
    })

    // Test pub type validation
    it('should validate pub name restrictions', () => {
      // pub names can only contain [a-z0-9_]
      expect(
        () =>
          new PackageURL(
            'pub',
            '',
            'invalid!name',
            '1.0.0',
            undefined,
            undefined,
          ),
      ).toThrow(/pub "name" component may only contain/)

      // Valid pub package
      const validPub = new PackageURL(
        'pub',
        '',
        'valid_name_123',
        '1.0.0',
        undefined,
        undefined,
      )
      expect(validPub.toString()).toBe('pkg:pub/valid_name_123@1.0.0')
    })

    // Test URL parsing edge cases
    it('should handle URL parsing edge cases', () => {
      // Test line 125 - colonIndex === -1 case
      expect(() => PackageURL.fromString('no-colon-here')).toThrow()

      // Test line 153 - missing pkg scheme
      expect(() => PackageURL.fromString('http://example.com')).toThrow(
        /missing required "pkg" scheme/,
      )
    })

    // Test error message formatting edge case
    it('should handle error message formatting with trailing dot', () => {
      // Test error.js line 19 - removing trailing dot from error messages
      const message = 'Error message.'
      const formatted = formatPurlErrorMessage(message)
      expect(formatted).toBe('Invalid purl: error message')
    })

    // Test recursiveFreeze infinite loop detection
    it('should detect infinite loops in recursiveFreeze', () => {
      // Create a structure that will exceed LOOP_SENTINEL when traversed
      // Use nested objects to reach the limit more efficiently
      const createDeepStructure = () => {
        const depth = 1000
        // depth * width > 1,000,000 (LOOP_SENTINEL)
        const width = 1001
        const root: any = { children: [] }

        for (let i = 0; i < width; i++) {
          let current = root
          for (let j = 0; j < depth; j++) {
            const child = { value: `${i}-${j}`, children: [] }
            current.children.push(child)
            current = child
          }
        }
        return root
      }

      const largeGraph = createDeepStructure()
      // This should throw when hitting the sentinel
      expect(() => recursiveFreeze(largeGraph)).toThrow(
        /Object graph too large/,
      )
    })

    // Test purl-component functions
    it('should handle PurlComponent edge cases', () => {
      // Test PurlComponent exports
      expect(PurlComponent).toBeDefined()
      expect(PurlComponent.name).toBeDefined()
      expect(PurlComponent.name.encode).toBeDefined()

      // Test component encoder with empty string
      // This tests PurlComponentEncoder function (line 32-33)
      const encoded = (PurlComponent.name.encode as any)('')
      expect(encoded).toBe('')

      // Test with non-empty string
      const encodedValid = (PurlComponent.name.encode as any)('test-name')
      expect(encodedValid).toBeTruthy()
    })

    // Test npm type edge cases with long names
    it('should validate npm namespace+name length limit', () => {
      const namespace = `@${'a'.repeat(100)}`
      // This makes namespace + name > 214 chars
      const name = 'b'.repeat(115)

      expect(
        () =>
          new PackageURL('npm', namespace, name, '1.0.0', undefined, undefined),
      ).toThrow(
        /npm "namespace" and "name" components can not collectively be more than 214 characters/,
      )
    })

    // Test npm name with capital letters
    it('should handle npm names with capital letters', () => {
      // NPM actually lowercases the name, not throws
      const purl = new PackageURL(
        'npm',
        '',
        'TestPackage',
        '1.0.0',
        undefined,
        undefined,
      )
      expect(purl.name).toBe('testpackage')
      expect(purl.toString()).toBe('pkg:npm/testpackage@1.0.0')
    })

    // Test npm name with special characters
    it('should reject npm names with special characters', () => {
      expect(
        () =>
          new PackageURL(
            'npm',
            '',
            'test*package',
            '1.0.0',
            undefined,
            undefined,
          ),
      ).toThrow(/npm "name" component can not contain special characters/)
    })

    // Test validate.js uncovered lines
    it('should validate empty component edge cases', () => {
      // Test line 12 - return false without throwing
      expect(
        validateEmptyByType('swift', 'namespace', 'not-empty', {
          throws: false,
        }),
      ).toBe(false)

      // Test with throws=true
      expect(() =>
        validateEmptyByType('swift', 'namespace', 'not-empty', {
          throws: true,
        }),
      ).toThrow(/swift "namespace" component must be empty/)
    })

    // Test validateQualifiers with non-object type
    it('should validate qualifiers must be an object', () => {
      // Test lines 33-36 - qualifiers must be a plain object
      expect(() =>
        validateQualifiers('string-value', { throws: true }),
      ).toThrow(/"qualifiers" must be a plain object/)

      expect(validateQualifiers('string-value', { throws: false })).toBe(false)
    })

    // Test validateQualifierKey with invalid key
    it('should validate qualifier key format', () => {
      // Test line 46 - return false
      expect(validateQualifierKey('1invalid', { throws: false })).toBe(false)

      // Test lines 73-76 - illegal character in key
      expect(() =>
        validateQualifierKey('key!invalid', { throws: true }),
      ).toThrow(/qualifier "key!invalid" contains an illegal character/)

      expect(validateQualifierKey('key!invalid', { throws: false })).toBe(false)
    })

    // Test encode.js branch coverage
    it('should handle encoding edge cases', () => {
      // Test encode.js lines for namespace encoding
      const namespace = 'test/namespace/path'
      const encoded = encodeNamespace(namespace)
      expect(encoded).toBe('test/namespace/path')
    })

    // Test normalize.js branch coverage
    it('should handle normalization edge cases', () => {
      // Test various namespace normalization paths
      const namespace1 = 'test//namespace'
      const normalized1 = normalizeNamespace(namespace1)
      expect(normalized1).toBe('test/namespace')
    })

    // Test package-url.js line 125 - URL parsing without auth
    it('should handle URL parsing without authority', () => {
      // Test the path where afterColon.length === trimmedAfterColon.length (line 141-142)
      const purl = PackageURL.fromString('pkg:npm/test@1.0.0')
      expect(purl.name).toBe('test')
    })

    // Test package-url.js lines 166-168 - empty path after type
    it('should handle purl with only type', () => {
      // Name is required, so this should throw
      expect(() => PackageURL.fromString('pkg:generic')).toThrow(
        /"name" is a required component/,
      )
    })

    // Test package-url.js lines 183-184 - @ preceded by /
    it('should handle @ preceded by slash in path', () => {
      const purl = PackageURL.fromString('pkg:npm/@scope/name')
      expect(purl.namespace).toBe('@scope')
      expect(purl.name).toBe('name')
      expect(purl.version).toBe(undefined)
    })

    // Test purl-type.js lines 317-319 - forbidden npm names
    it('should reject forbidden npm names', () => {
      expect(
        () =>
          new PackageURL(
            'npm',
            '',
            'node_modules',
            '1.0.0',
            undefined,
            undefined,
          ),
      ).toThrow(/npm "name" component of "node_modules" is not allowed/)

      expect(
        () =>
          new PackageURL(
            'npm',
            '',
            'favicon.ico',
            '1.0.0',
            undefined,
            undefined,
          ),
      ).toThrow(/npm "name" component of "favicon.ico" is not allowed/)
    })

    // Test purl-type.js lines 334-338 - npm name with uppercase (not throwing)
    it('should handle npm type validation without throwing', () => {
      // npm.validate expects an object with namespace and name properties
      const comp1 = { namespace: '@TEST', name: 'test' }
      const result1 = (PurlType.npm as any).validate(comp1, false)
      expect(result1).toBe(false)

      // Test validation for name with special characters
      const comp2 = { namespace: '', name: 'name!with!special' }
      const result2 = (PurlType.npm as any).validate(comp2, false)
      expect(result2).toBe(false)

      // Test validation for forbidden names
      const comp3 = { namespace: '', name: 'node_modules' }
      const result3 = (PurlType.npm as any).validate(comp3, false)
      expect(result3).toBe(false)
    })

    // Test encode.js branches
    it('should handle encoding branches', () => {
      // Test encodeVersion with special characters
      const version = encodeVersion('1.0.0+build')
      expect(version).toBeTruthy()

      // Test encodeSubpath with empty path
      const subpath = encodeSubpath('')
      expect(subpath).toBe('')
    })

    // Test additional validate.js line 46
    it('should validate qualifier keys in URLSearchParams', () => {
      const searchParams = new URLSearchParams()
      searchParams.append('1invalid', 'value')
      searchParams.append('valid_key', 'value2')

      expect(
        () =>
          new PackageURL('npm', '', 'test', '1.0.0', searchParams, undefined),
      ).toThrow(/qualifier "1invalid" cannot start with a number/)
    })

    // Test purl-component.js line 36 - non-string normalization
    it('should handle PurlComponentStringNormalizer with various types', () => {
      // Instead, let's test directly accessing internal functions
      // This exercises line 36 in purl-component.js

      // Test that components have the expected structure
      expect(PurlComponent.name).toBeDefined()
      expect(PurlComponent.name.normalize).toBeDefined()
      expect(PurlComponent.name.validate).toBeDefined()

      // Test normalizing name with a number (tests line 36)
      const result = (PurlComponent.name.normalize as any)('test123')
      expect(result).toBe('test123')
    })

    // Test error.js line 12 - uppercase to lowercase

    // Test objects.js line 33 - infinite loop branch
    it('should handle massive arrays in recursiveFreeze', () => {
      // Create object with nested structures but under the limit
      const obj = { a: { b: { c: [] } } }
      for (let i = 0; i < 100; i++) {
        ;(obj.a.b.c as any).push({ value: i })
      }

      const frozen = recursiveFreeze(obj)
      expect(Object.isFrozen(frozen)).toBe(true)
      expect(Object.isFrozen(frozen.a.b.c[0])).toBe(true)
    })

    // Additional tests for uncovered lines
    it('should handle package-url.js line 125 edge case', () => {
      // Test when URL() constructor fails
      expect(() => PackageURL.fromString('pkg')).toThrow()
    })

    // Test encode.js line 21 - encoding empty values
    it('should handle encoding empty values', () => {
      expect(encodeComponent('')).toBe('')
      expect(encodeComponent('test')).toBe('test')
    })

    // Test encode.js line 60 - encoding qualifiers
    it('should handle encoding qualifiers edge cases', () => {
      expect(encodeQualifiers(null)).toBe('')
      expect(encodeQualifiers(undefined)).toBe('')
      expect(encodeQualifiers({})).toBe('')
    })

    // Test encode.js line 73 - encoding subpath
    it('should handle encoding subpath with leading slash', () => {
      // encodeSubpath doesn't strip leading slashes
      expect(encodeSubpath('/path/to/file')).toContain('path/to/file')
      expect(encodeSubpath('path/to/file')).toBe('path/to/file')
    })

    // Test normalize.js lines 103-104, 109-110
    it('should handle normalization edge cases for various types', () => {
      // Test golang type normalization (lines 109-110)
      const goNs = normalizeNamespace('github.com//owner//repo')
      expect(goNs).toBe('github.com/owner/repo')

      // Test generic normalization
      const genericNs = normalizeNamespace('test')
      expect(genericNs).toBe('test')
    })

    // Test validate.js line 46 - qualifier key validation
    it('should handle invalid qualifier keys', () => {
      // Test returning false without throwing
      expect(validateQualifierKey('1startsWithNumber', { throws: false })).toBe(
        false,
      )
      expect(validateQualifierKey('has-dashes', { throws: false })).toBe(true)
      expect(validateQualifierKey('has_underscores', { throws: false })).toBe(
        true,
      )
      expect(validateQualifierKey('has.periods', { throws: false })).toBe(true)
    })

    // Test purl-component.js line 36
    it('should test PurlComponentStringNormalizer directly', () => {
      // Access internal functions through require cache manipulation
      const modulePath = require.resolve('../src/purl-component.ts')
      delete require.cache[modulePath]

      // Re-require to get fresh module

      // Test that normalizer works as expected
      const nameNorm = PurlComponent.name.normalize as any
      expect(typeof nameNorm).toBe('function')
      expect(nameNorm('test')).toBe('test')
    })

    // Test PurlComponentStringNormalizer internal function (line 36)
    it('should test PurlComponentStringNormalizer with non-string values', () => {
      // Test line 36 - returns undefined for non-string
      expect(PurlComponentStringNormalizer(123)).toBe(undefined)
      expect(PurlComponentStringNormalizer(null)).toBe(undefined)
      expect(PurlComponentStringNormalizer(undefined)).toBe(undefined)
      expect(PurlComponentStringNormalizer({})).toBe(undefined)
      expect(PurlComponentStringNormalizer([])).toBe(undefined)
      expect(PurlComponentStringNormalizer(true)).toBe(undefined)

      // Returns the string for string values
      expect(PurlComponentStringNormalizer('test')).toBe('test')
      expect(PurlComponentStringNormalizer('')).toBe('')
    })

    // Test purl-type.js lines 307-310 - npm namespace validation
    it('should test npm namespace validation with special characters', () => {
      // Test validation with invalid namespace characters (lines 307-310)
      // The exclamation mark is actually URL-encoded so it passes validation
      const comp1 = { namespace: '@namespace with spaces', name: 'test' }
      const result1 = (PurlType.npm as any).validate(comp1, false)
      expect(result1).toBe(false)

      // Test with throwing enabled
      expect(() => (PurlType.npm as any).validate(comp1, true)).toThrow(
        /npm "namespace" component can only contain URL-friendly characters/,
      )
    })

    // Test purl-type.js lines 335-338 - npm name uppercase validation
    it('should test npm name validation for modern packages with uppercase', () => {
      // Test with a modern package name (not in legacy list) that has special characters
      const comp = { namespace: '', name: 'my-package*' }
      const result = (PurlType.npm as any).validate(comp, false)
      expect(result).toBe(false)

      // Test with throwing enabled for special characters
      expect(() => (PurlType.npm as any).validate(comp, true)).toThrow(
        /npm "name" component can not contain special characters/,
      )
    })

    // Test purl-type.js lines 282-291 - npm name with non-URL-friendly characters
    it.each([
      'package<>',
      'package[brackets]',
      'package{braces}',
      'package|pipe',
      'package\\backslash',
      'package^caret',
      'package space',
      // Non-ASCII characters
      'パッケージ',
    ])('should reject npm name with non-URL-friendly chars: %s', name => {
      const comp = { namespace: '', name }
      const expectedError =
        /npm "name" component can only contain URL-friendly characters/

      // Test with throwing disabled - should return false
      const result = (PurlType.npm as any).validate(comp, false)
      expect(result).toBe(false)

      // Test with throwing enabled - should throw with expected error
      expect(() => (PurlType.npm as any).validate(comp, true)).toThrow(
        expectedError,
      )
    })

    it.each(['package-name', 'package_name', 'package.name', 'package123'])(
      'should accept npm name with URL-friendly chars: %s',
      name => {
        const comp = { namespace: '', name }
        // Should not throw
        const result = (PurlType.npm as any).validate(comp, true)
        expect(result).toBe(true)
      },
    )

    // Test encode.js line 21 - null/undefined handling
    it('should test encode component with falsy values', () => {
      // encodeComponent is just encodeURIComponent alias
      expect(encodeComponent('test')).toBe('test')
      expect(encodeComponent('')).toBe('')
      expect(encodeComponent('special!@#')).toBe('special!%40%23')
    })

    // Test encode.js line 73 - subpath normalization
    it('should test encodeSubpath with slashes', () => {
      // Test line 67 - encodeSubpath preserves slashes
      expect(encodeSubpath('path/to/file')).toBe('path/to/file')
      expect(encodeSubpath('path/to/file with spaces')).toBe(
        'path/to/file%20with%20spaces',
      )

      // Test line 73 in encodeVersion
      expect(encodeVersion('1.0.0:rc1')).toBe('1.0.0:rc1')
      expect(encodeVersion('2.0.0:beta')).toBe('2.0.0:beta')
    })

    // Test normalize.js lines 103-104 - subpathFilter edge cases
    it('should test subpathFilter edge cases in normalize', () => {
      // Test lines 103-104 - filters out single dot
      expect(normalizeSubpath('./path/to/file')).toBe('path/to/file')
      expect(normalizeSubpath('path/./to/file')).toBe('path/to/file')

      // Test lines 109-110 - filters out double dots
      expect(normalizeSubpath('../path/to/file')).toBe('path/to/file')
      expect(normalizeSubpath('path/../to/file')).toBe('path/to/file')
    })

    // Test normalize.js lines 109-110 - golang double slash normalization
    it('should test golang namespace normalization with double slashes', () => {
      // Test lines 109-110 - golang normalizes double slashes
      expect(normalizeNamespace('github.com//owner//repo')).toBe(
        'github.com/owner/repo',
      )
      expect(normalizeNamespace('example.com///path///to///repo')).toBe(
        'example.com/path/to/repo',
      )
      expect(normalizeNamespace('github.com/owner/repo')).toBe(
        'github.com/owner/repo',
      )
    })

    // Test package-url.js line 125 - missing colon in purl string
    it('should test fromString with no colon in purl', () => {
      // Test line 125 - colonIndex === -1
      expect(() => PackageURL.fromString('noColonInString')).toThrow(
        /missing required "pkg" scheme/,
      )
    })

    // Test package-url.js line 153 - missing pkg scheme
    it('should test fromString with wrong scheme', () => {
      // Test line 153 - protocol check
      expect(() => PackageURL.fromString('http://example.com/package')).toThrow(
        /missing required "pkg" scheme/,
      )
      expect(() =>
        PackageURL.fromString('https://example.com/package'),
      ).toThrow(/missing required "pkg" scheme/)
      expect(() => PackageURL.fromString('ftp://example.com/package')).toThrow(
        /missing required "pkg" scheme/,
      )
    })

    // Test validate.js line 46 - qualifier key validation return false
    it('should test qualifier key validation edge cases', () => {
      // Test line 46 - returns false when validateStartsWithoutNumber fails
      expect(validateQualifierKey('1start', { throws: false })).toBe(false)
      expect(validateQualifierKey('9number', { throws: false })).toBe(false)

      // Valid keys
      expect(validateQualifierKey('valid_key', { throws: false })).toBe(true)
      expect(validateQualifierKey('another.valid-key', { throws: false })).toBe(
        true,
      )
    })

    // Test objects.js line 33 - check for recursiveFreeze edge case

    // Test error.js line 12 - lowercase conversion edge case

    // Additional tests for 100% coverage
    // Test normalize.js lines 7, 13 - namespaceFilter
    it('should test namespace filter edge cases', () => {
      // Test namespace normalization for various types
      // normalizeNamespace doesn't filter . and .. for namespaces
      const result1 = normalizeNamespace('./some/namespace')
      expect(result1).toBe('./some/namespace')

      const result2 = normalizeNamespace('../path')
      expect(result2).toBe('../path')

      const result3 = normalizeNamespace('')
      expect(result3).toBe('')
    })

    // Test normalize.js lines 73-84 - normalizeSubpath with non-string
    it('should test normalizeSubpath with non-string values', () => {
      expect(normalizeSubpath(123)).toBe(undefined)
      expect(normalizeSubpath(null)).toBe(undefined)
      expect(normalizeSubpath(undefined)).toBe(undefined)
    })

    // Test normalize.js line 95 - qualifiersToEntries with string
    it('should test qualifiersToEntries with string parameter', () => {
      const result = normalizeQualifiers('key1=value1&key2=value2')
      expect(result).toEqual({ key1: 'value1', key2: 'value2' })
    })

    // Test encode.js line 21 - encodeNamespace with empty string
    it('should test encodeNamespace with empty values', () => {
      expect(encodeNamespace('')).toBe('')
      expect(encodeNamespace(null)).toBe('')
      expect(encodeNamespace(undefined)).toBe('')
    })

    // Test encode.js line 73 - encodeVersion with colons
    it('should test encodeVersion preserves colons', () => {
      expect(encodeVersion('')).toBe('')
      expect(encodeVersion(null)).toBe('')
      expect(encodeVersion('1.0.0:rc.1')).toBe('1.0.0:rc.1')
    })

    // Test purl-component.js line 33 - PurlComponentEncoder with empty
    it('should test PurlComponentEncoder with non-strings', () => {
      // Test the encode function with empty values
      const encoded = PurlComponentEncoder(null)
      expect(encoded).toBe('')
      const encoded2 = PurlComponentEncoder(0)
      expect(encoded2).toBe('')
      const encoded3 = PurlComponentEncoder('test')
      expect(encoded3).toBe('test')
    })

    // Test purl-component.js line 38 - PurlComponentValidator
    it('should test PurlComponentValidator', () => {
      // Test the validator function - it always returns true
      const result1 = PurlComponentValidator('test', true)
      expect(result1).toBe(true)
      const result2 = PurlComponentValidator(null, false)
      expect(result2).toBe(true)
      const result3 = PurlComponentValidator(undefined, false)
      expect(result3).toBe(true)
    })

    // Test purl-component.js line 53 - componentSortOrder default
    it('should test component comparator with unknown components', () => {
      // Test comparator with unknown component names
      const order = componentComparator('unknown1', 'unknown2')
      expect(typeof order).toBe('number')

      // Test componentSortOrder directly - line 53
      const sortOrder = componentSortOrder('unknownComponent')
      expect(sortOrder).toBe('unknownComponent')
    })

    // Test purl-type.js lines 291-294 - npm namespace with trailing spaces
    it('should test npm namespace with leading/trailing spaces', () => {
      const comp = { namespace: ' @namespace ', name: 'test' }
      const result = (PurlType.npm as any).validate(comp, false)
      expect(result).toBe(false)

      expect(() => (PurlType.npm as any).validate(comp, true)).toThrow(
        /npm "namespace" component cannot contain leading or trailing spaces/,
      )
    })

    // Test purl-type.js lines 335-338 - npm name uppercase for non-legacy
    it('should test npm name uppercase validation edge case', () => {
      // Test a package name that's definitely not in the legacy list
      const comp = {
        namespace: '',
        name: 'VERYNEWPACKAGE2025THATDOESNOTEXIST',
      }
      const result = (PurlType.npm as any).validate(comp, false)
      expect(result).toBe(false)

      expect(() => (PurlType.npm as any).validate(comp, true)).toThrow(
        /npm "name" component can not contain capital letters/,
      )
    })

    // Test package-url.js line 125 - URL constructor error
    it('should test invalid URL construction', () => {
      // This tests the catch block for URL constructor failure
      expect(() => PackageURL.fromString('pkg:')).toThrow()
    })

    // Test package-url.js line 153 - null protocol check
    it('should test missing protocol edge case', () => {
      expect(() => PackageURL.fromString('')).toThrow()
    })

    // Test validate.js line 46 - validateQualifierKey early return
    it('should test validateQualifierKey with number start', () => {
      const qualifiers = { '9key': 'value' }
      const result = validateQualifiers(qualifiers, { throws: false })
      expect(result).toBe(false)
    })

    // Test error.js line 12 - check for uppercase A-Z range

    // Test objects.js line 33 - else branch (non-array)
    it('should test recursiveFreeze with objects that have getters', () => {
      const obj = {
        get computed() {
          return 'value'
        },
      }

      const frozen = recursiveFreeze(obj)
      expect(Object.isFrozen(frozen)).toBe(true)
    })

    // Final tests for 100% coverage
    // Test normalize.js lines 7, 13 - subpath filtering
    it('should test subpath with dot segments', () => {
      // Test lines 7, 13 - filters . and ..
      expect(normalizeSubpath('./path/to/file')).toBe('path/to/file')
      expect(normalizeSubpath('../../../path')).toBe('/path')
      expect(normalizeSubpath('.')).toBe('.')
      expect(normalizeSubpath('..')).toBe('..')
    })

    // Test normalize.js lines 80-84
    it('should test normalizeType and normalizeVersion edge cases', () => {
      // Export these functions for testing
      expect(normalizeType).toBeDefined()
      expect(normalizeVersion).toBeDefined()

      // Test normalizeType with non-strings
      expect(normalizeType(123)).toBe(undefined)
      expect(normalizeVersion(123)).toBe(undefined)
    })

    // Test normalize.js line 95
    it('should test qualifiersToEntries with URLSearchParams string', () => {
      const result = normalizeQualifiers('foo=bar&baz=qux')
      expect(result).toHaveProperty('foo', 'bar')
      expect(result).toHaveProperty('baz', 'qux')
    })

    // Test error.js line 12 - conditional branch

    // Test objects.js line 33 - property descriptor iteration
    it('should test recursiveFreeze with symbols and non-enumerable props', () => {
      const sym = Symbol('test')
      const obj = {
        [sym]: { nested: 'value' },
        regular: { prop: 'test' },
      }
      Object.defineProperty(obj, 'nonEnum', {
        value: { data: 'hidden' },
        enumerable: false,
      })

      const frozen = recursiveFreeze(obj)
      expect(Object.isFrozen(frozen)).toBe(true)
    })

    // Test package-url.js line 125 - URL parsing with invalid input
    it('should test fromString with malformed URL', () => {
      expect(() => PackageURL.fromString('pkg::')).toThrow()
      expect(() => PackageURL.fromString('pkg: ')).toThrow()
    })

    // Test package-url.js line 153 - protocol undefined check
    it('should test fromString when URL parsing returns undefined protocol', () => {
      // This triggers line 153
      expect(() => PackageURL.fromString('invalid')).toThrow(
        /missing required "pkg" scheme/,
      )
    })

    // Test purl-type.js lines 273-277 - npm name trimming
    it('should test npm name with leading/trailing spaces', () => {
      const comp = { namespace: '', name: ' test-name ' }
      const result = (PurlType.npm as any).validate(comp, false)
      expect(result).toBe(false)

      expect(() => (PurlType.npm as any).validate(comp, true)).toThrow(
        /npm "name" component cannot contain leading or trailing spaces/,
      )
    })

    // Test purl-type.js lines 281-285 - npm name starting with dot
    it('should test npm name starting with dot', () => {
      const comp = { namespace: '', name: '.hidden-package' }
      const result = (PurlType.npm as any).validate(comp, false)
      expect(result).toBe(false)

      expect(() => (PurlType.npm as any).validate(comp, true)).toThrow(
        /npm "name" component cannot start with a period/,
      )
    })

    // Test validate.js line 40 - URLSearchParams check
    it('should test validateQualifiers with URLSearchParams instance', () => {
      const params = new URLSearchParams()
      params.append('valid_key', 'value')
      const result = validateQualifiers(params, { throws: false })
      expect(result).toBe(true)
    })

    // Test validate.js lines 121, 135, 156 - various validation branches
    it('should test validation utility functions thoroughly', () => {
      // Test line 121 - validateStartsWithoutNumber
      expect(
        validateStartsWithoutNumber('test', '0start', { throws: false }),
      ).toBe(false)
      expect(() =>
        validateStartsWithoutNumber('test', '0start', { throws: true }),
      ).toThrow(/test "0start" cannot start with a number/)

      // Test line 135 - validateSubpath empty check
      expect(validateSubpath('', { throws: false })).toBe(true)
      expect(validateSubpath(null, { throws: false })).toBe(true)

      // Test line 156 - validateRequiredByType
      expect(
        validateRequiredByType('swift', 'version', '', { throws: false }),
      ).toBe(false)
      expect(() =>
        validateRequiredByType('swift', 'version', '', { throws: true }),
      ).toThrow(/swift requires a "version" component/)
    })

    // Additional tests for remaining uncovered lines
    // Test purl-type.js lines 220-223 - golang version validation
    it('should test golang version validation', () => {
      // Test golang version starting with v but not valid semver
      const comp = {
        namespace: 'github.com/owner/repo',
        name: 'test',
        version: 'vInvalid',
      }
      const result = (PurlType.golang as any).validate(comp, false)
      expect(result).toBe(false)

      expect(() => (PurlType.golang as any).validate(comp, true)).toThrow(
        /golang "version" component starting with a "v" must be followed by a valid semver version/,
      )
    })

    // Test purl-type.js lines 281-285 - npm name starting with underscore
    it('should test npm name starting with underscore', () => {
      const comp = { namespace: '', name: '_hidden' }
      const result = (PurlType.npm as any).validate(comp, false)
      expect(result).toBe(false)

      expect(() => (PurlType.npm as any).validate(comp, true)).toThrow(
        /npm "name" component cannot start with an underscore/,
      )
    })

    // Test normalize.js lines 7, 13 - namespace path filtering
    it('should test namespace path filtering', () => {
      // For types that filter paths
      const result = normalizeNamespace('vendor/package')
      expect(result).toBe('vendor/package')

      // Test empty namespace
      const result2 = normalizeNamespace(null)
      expect(result2).toBe(undefined)
    })

    // Test normalize.js line 95 - qualifiersToEntries edge case
    it('should test qualifiersToEntries with invalid input', () => {
      // Direct test of qualifiersToEntries
      expect(normalizeQualifiers).toBeDefined()
      const result = normalizeQualifiers(123)
      expect(result).toEqual(undefined)
    })

    // Test package-url.js line 125 - colonIndex === -1
    it('should test URL parsing without colon', () => {
      expect(() => PackageURL.fromString('pkgwithoutcolon')).toThrow()
    })

    // Test package-url.js line 153 - null URL protocol
    it('should test URL protocol null check', () => {
      expect(() => PackageURL.fromString('randomtext')).toThrow(
        /missing required "pkg" scheme/,
      )
    })

    // Test error.js line 12 - OR condition in uppercase check

    // Test objects.js line 33 - Object.values path
    it('should test recursiveFreeze with Object.values path', () => {
      // Test the else path for non-arrays
      const obj = { a: { b: 1 }, c: { d: 2 } }
      const frozen = recursiveFreeze(obj)
      expect(Object.isFrozen(frozen.a)).toBe(true)
      expect(Object.isFrozen(frozen.c)).toBe(true)
    })

    // Test validate.js lines 121, 135, 156 - edge cases
    it('should test additional validation edge cases', () => {
      // Test validateSubpath with various inputs (line 135)
      expect(validateSubpath(undefined, { throws: false })).toBe(true)
      expect(validateSubpath('valid/path', { throws: false })).toBe(true)

      // Test validateStartsWithoutNumber edge case (line 121)
      expect(
        validateStartsWithoutNumber('qualifier', 'valid', { throws: false }),
      ).toBe(true)

      // Test validateRequiredByType with non-empty value (line 156)
      expect(
        validateRequiredByType('swift', 'version', '1.0.0', {
          throws: false,
        }),
      ).toBe(true)
    })

    // Final tests for 100% coverage
    // Test package-url.js lines 167-168 - parse with only type
    it('should test PackageURL parsing with only type component', () => {
      // This tests the early return when no slash after type
      expect(() => PackageURL.fromString('pkg:type')).toThrow(
        /"name" is a required component/,
      )
    })

    // Test package-url.js lines 183-184 - @ preceded by /
    it('should test @ symbol preceded by slash', () => {
      // Test the case where @ is preceded by / (not a version separator)
      const parsed = PackageURL.fromString('pkg:npm/@scope/package')
      expect(parsed.namespace).toBe('@scope')
      expect(parsed.name).toBe('package')
      expect(parsed.version).toBe(undefined)
    })

    // Test purl-type.js lines 194-197 - conan with namespace but no qualifiers
    it('should test conan validation with namespace but no qualifiers', () => {
      const comp = { namespace: 'namespace', name: 'test', qualifiers: null }
      const result = (PurlType.conan as any).validate(comp, false)
      expect(result).toBe(false)

      expect(() => (PurlType.conan as any).validate(comp, true)).toThrow(
        /conan requires a "qualifiers" component when a namespace is present/,
      )
    })

    // Test purl-type.js lines 281-285 - npm name edge cases
    it('should test npm name with period and underscore prefixes', () => {
      // Test name starting with period
      const comp1 = { namespace: '', name: '.test' }
      const result1 = (PurlType.npm as any).validate(comp1, false)
      expect(result1).toBe(false)

      // Test name starting with underscore
      const comp2 = { namespace: '', name: '_test' }
      const result2 = (PurlType.npm as any).validate(comp2, false)
      expect(result2).toBe(false)
    })

    // Test normalize.js line 7 - filtering single dot
    it('should test normalize filtering single dots', () => {
      // Test filtering of single dots in paths
      const result = normalizeSubpath('path/./to/./file')
      expect(result).toBe('path/to/file')
    })

    // Test error.js line 12 - the && condition
    it('should test error uppercase check condition', () => {
      // Test the boundary condition
      const result1 = formatPurlErrorMessage('A')
      expect(result1).toBe('Invalid purl: a')

      // Test character just outside range
      // Character after Z
      const result2 = formatPurlErrorMessage('[')
      expect(result2).toBe('Invalid purl: [')
    })

    // Test objects.js line 33 - else branch with Object.values
    it('should test recursiveFreeze with plain objects', () => {
      // Force the else branch (not an array)
      const obj = Object.create(null)
      obj.prop1 = { nested: 'value1' }
      obj.prop2 = { nested: 'value2' }

      const frozen = recursiveFreeze(obj)
      expect(Object.isFrozen(frozen.prop1)).toBe(true)
      expect(Object.isFrozen(frozen.prop2)).toBe(true)
    })

    // Test validate.js final edge cases
    it('should test validate functions final edge cases', () => {
      // Test validateStartsWithoutNumber with actual number start (line 121)
      const result1 = validateStartsWithoutNumber('key', '5test', {
        throws: false,
      })
      expect(result1).toBe(false)

      // Test validateSubpath with blank string (line 135)
      const result2 = validateSubpath('   ', { throws: false })
      expect(result2).toBe(true)

      // Test validateRequiredByType with nullish value (line 156)
      const result3 = validateRequiredByType('type', 'comp', null, {
        throws: false,
      })
      expect(result3).toBe(false)
    })

    // Additional tests for 100% coverage
    // Test purl-type.js lines 185-189 - conan with channel but no namespace
    it('should test conan validation with channel qualifier but no namespace', () => {
      const comp = {
        namespace: '',
        name: 'test',
        qualifiers: { channel: 'stable' },
      }
      const result = (PurlType.conan as any).validate(comp, false)
      expect(result).toBe(false)

      expect(() => (PurlType.conan as any).validate(comp, true)).toThrow(
        /conan requires a "namespace" component when a "channel" qualifier is present/,
      )
    })

    // Test package-url.js parse edge cases
    it('should test PackageURL parsing special cases', () => {
      // Test parsing purl with empty path after type - should throw
      expect(() => PackageURL.fromString('pkg:generic/')).toThrow(
        /"name" is a required component/,
      )
    })

    // Test for 100% coverage - line 125 (colonIndex === -1)
    it('should handle malformed purl without colon', () => {
      // This should trigger the colonIndex === -1 path
      expect(() => PackageURL.fromString('malformed')).toThrow()
      expect(() => PackageURL.fromString('pkg')).toThrow()
    })

    // Test for 100% coverage - line 153 (url is null/undefined)
    it('should handle URL parsing that returns null protocol', () => {
      // Force a case where URL parsing fails or returns null
      expect(() => PackageURL.fromString(':::')).toThrow()
      expect(() => PackageURL.fromString('pkg ')).toThrow()
    })

    // Test package-url.js lines 167-168 - no slash after type
    it('should handle purl with no slash after type', () => {
      // This triggers the firstSlashIndex < 1 path
      const result = PackageURL.parseString('pkg:type')
      expect(result[0]).toBe('type')
      expect(result[1]).toBe(undefined)
      expect(result[2]).toBe(undefined)
    })

    // Test package-url.js lines 183-184 - @ preceded by /
    it('should handle @ symbol with preceding slash', () => {
      // Test case where @ is preceded by / (not a version separator)
      const purl = PackageURL.fromString('pkg:generic/namespace/@subpath')
      expect(purl.namespace).toBe('namespace')
      expect(purl.name).toBe('@subpath')
      expect(purl.version).toBe(undefined)
    })

    // Test purl-type.js lines 97-99 - gitlab normalizer
    it('should test gitlab purl type normalization', () => {
      const purl = new PackageURL(
        'gitlab',
        'Namespace',
        'Name',
        '1.0.0',
        undefined,
        undefined,
      )
      expect(purl.toString()).toBe('pkg:gitlab/namespace/name@1.0.0')

      const purl2 = PackageURL.fromString('pkg:gitlab/Group/Project@v1.0.0')
      expect(purl2.namespace).toBe('group')
      expect(purl2.name).toBe('project')
    })

    // Test purl-type.js lines 281-285 - npm name validation
    it('should test npm name prefix validation thoroughly', () => {
      // Test line 283 - period check
      const comp1 = { namespace: '', name: '.hidden' }
      expect((PurlType.npm as any).validate(comp1, false)).toBe(false)

      // Test line 285 - underscore check
      const comp2 = { namespace: '', name: '_private' }
      expect((PurlType.npm as any).validate(comp2, false)).toBe(false)

      // Valid name
      const comp3 = { namespace: '', name: 'valid-name' }
      expect((PurlType.npm as any).validate(comp3, false)).toBe(true)
    })

    // Additional branch coverage tests
    it('should test all branch conditions', () => {
      // Test error.js line 12 - both branches

      // Character code 65 is 'A', 90 is 'Z'
      expect(formatPurlErrorMessage('A message')).toBe(
        'Invalid purl: a message',
      )
      expect(formatPurlErrorMessage('Z message')).toBe(
        'Invalid purl: z message',
      )
      expect(formatPurlErrorMessage('[ message')).toBe(
        'Invalid purl: [ message',
        // After Z
      )
      expect(formatPurlErrorMessage('@ message')).toBe(
        'Invalid purl: @ message',
        // Before A
      )

      // Test normalize.js line 7 - namespace filter
      expect(normalizeNamespace('.')).toBe('.')
      expect(normalizeNamespace('..')).toBe('..')
      expect(normalizeNamespace('.hidden')).toBe('.hidden')

      // Test objects.js line 33 - array vs object branch

      // Test with array
      const arr = [{ a: 1 }, { b: 2 }]
      const frozenArr = recursiveFreeze(arr)
      expect(Object.isFrozen(frozenArr[0])).toBe(true)

      // Test with object (non-array)
      const obj = { x: { y: 1 } }
      const frozenObj = recursiveFreeze(obj)
      expect(Object.isFrozen(frozenObj.x)).toBe(true)
    })

    // Test for line 169 - decodePurlComponent
    it('should handle purl with encoded type component (edge case)', () => {
      // Test a type that contains URL-encoded characters
      const purlWithEncodedType = 'pkg:type%2Dwith%2Ddashes/namespace/name'

      // This should decode the type properly (line 169)
      const purl = PackageURL.fromString(purlWithEncodedType)
      expect(purl.type).toBe('type-with-dashes')
    })

    // Additional coverage tests for edge cases
    it('should test normalizeName with non-string input', () => {
      // Test with non-string input (line 7 branch)
      expect(normalizeName(null)).toBe(undefined)
      expect(normalizeName(undefined)).toBe(undefined)
      expect(normalizeName(123)).toBe(undefined)
    })

    it('should test recursiveFreeze with functions', () => {
      // Test freezing objects containing functions (line 35 branch)
      const objWithFunc = {
        method: () => 'test',
        data: { nested: 'value' },
      }
      const frozen = recursiveFreeze(objWithFunc)
      expect(Object.isFrozen(frozen.method)).toBe(true)
      expect(Object.isFrozen(frozen.data)).toBe(true)
    })

    it('should test validation edge cases', () => {
      // Test validateStrings with non-string input (line 121)
      expect(validateStrings('test', 123, { throws: false })).toBe(false)
      expect(validateStrings('test', {}, { throws: false })).toBe(false)

      // Test validateStartsWithoutNumber (line 135)
      expect(
        validateStartsWithoutNumber('test', '9name', { throws: false }),
      ).toBe(false)

      // Test validateType with type starting with number (line 135 branch)
      expect(validateType('9type', { throws: false })).toBe(false)

      // Test validateType with illegal character in throws mode (line 156)
      expect(() => validateType('type$illegal', { throws: true })).toThrow(
        'type "type$illegal" contains an illegal character',
      )
    })

    it('should cover missing package-url.js branches', () => {
      // Test the case where colonIndex === -1 (no colon in the string)
      expect(() => PackageURL.fromString('notapurl')).toThrow(
        'missing required "pkg" scheme component',
      )

      // Test the case where url is undefined because colonIndex is -1
      expect(() => PackageURL.fromString('nocolonhere')).toThrow(
        'missing required "pkg" scheme component',
      )

      // Test URL parsing failure (line 145 branch) - malformed URL
      expect(() => PackageURL.fromString('pkg::')).toThrow(
        'type ":" contains an illegal character',
      )

      // Test the maybeUrlWithAuth branch where afterColon.length !== trimmedAfterColon.length
      // This happens when there are leading slashes after the colon
      expect(() => PackageURL.fromString('pkg://username@npm/package')).toThrow(
        'cannot contain a "user:pass@host:port"',
      )

      // Test @ preceded by / is not treated as version separator
      const purl1 = PackageURL.fromString('pkg:type/namespace/@name')
      expect(purl1.name).toBe('@name')
      expect(purl1.version).toBeUndefined()

      // Test @ preceded by / in subpath is not treated as version separator
      const purl2 = PackageURL.fromString(
        'pkg:type/namespace/name#subpath/@file',
      )
      expect(purl2.name).toBe('name')
      expect(purl2.version).toBeUndefined()
      expect(purl2.subpath).toBe('subpath/@file')

      // Test version extraction ternary - with version (atSignIndex !== -1)
      const purl3 = PackageURL.fromString('pkg:type/namespace/name@1.0.0')
      expect(purl3.namespace).toBe('namespace')
      expect(purl3.name).toBe('name')
      expect(purl3.version).toBe('1.0.0')

      // Test version extraction ternary - without version (atSignIndex === -1)
      const purl4 = PackageURL.fromString('pkg:type/namespace/name')
      expect(purl4.namespace).toBe('namespace')
      expect(purl4.name).toBe('name')
      expect(purl4.version).toBeUndefined()

      // Test version extraction with just type and name (no namespace)
      const purl5 = PackageURL.fromString('pkg:type/name@2.0.0')
      expect(purl5.namespace).toBeUndefined()
      expect(purl5.name).toBe('name')
      expect(purl5.version).toBe('2.0.0')

      // Test version extraction with just type and name, no version
      const purl6 = PackageURL.fromString('pkg:type/name')
      expect(purl6.namespace).toBeUndefined()
      expect(purl6.name).toBe('name')
      expect(purl6.version).toBeUndefined()
    })

    it('should cover missing purl-type.js branches', () => {
      // Test npm name validation error branches

      // Test npm name > 214 chars with throws (line 331)
      const longName = 'a'.repeat(215)
      expect(
        () =>
          new PackageURL(
            'npm',
            null,
            longName,
            undefined,
            undefined,
            undefined,
          ),
      ).toThrow('"name" exceeds maximum length of 214 characters')

      // Test npm core module name with throws (line 355)
      // Use a builtin that's not a legacy name (legacy names skip the builtin check)
      expect(
        () =>
          new PackageURL(
            'npm',
            null,
            'worker_threads',
            undefined,
            undefined,
            undefined,
          ),
      ).toThrow('npm "name" component can not be a core module name')

      // Test pub name with illegal character in throws mode (line 384)
      // Note: dashes are normalized to underscores, uppercase is normalized to lowercase
      // Use a special character that's not allowed like @
      expect(
        () =>
          new PackageURL(
            'pub',
            null,
            'name@with',
            undefined,
            undefined,
            undefined,
          ),
      ).toThrow('pub "name" component may only contain [a-z0-9_] characters')
    })

    it('should test deep freeze with function type', () => {
      // Test freezing object with function as property
      const func: any = createTestFunction('test')
      ;(func as any).prop = 'value'

      const obj = {
        fn: func,
        nested: {
          anotherFn: createTestFunction('another'),
        },
      }

      const frozen = recursiveFreeze(obj)
      expect(Object.isFrozen(frozen.fn)).toBe(true)
      expect(Object.isFrozen(frozen.nested.anotherFn)).toBe(true)
    })

    it('should test additional edge cases for maximum coverage', () => {
      // Test edge cases for npm validation
      const purl1 = new PackageURL(
        'npm',
        '@scope',
        'package-name_123',
        undefined,
        undefined,
        undefined,
      )
      expect(purl1.namespace).toBe('@scope')

      // Test edge cases for pub validation with special characters
      expect(
        () =>
          new PackageURL(
            'pub',
            null,
            'name!special',
            undefined,
            undefined,
            undefined,
          ),
      ).toThrow()
      expect(
        () =>
          new PackageURL(
            'pub',
            null,
            'name#hash',
            undefined,
            undefined,
            undefined,
          ),
      ).toThrow()

      // Test URL parsing edge cases with different malformed URLs
      expect(() => PackageURL.fromString('::::')).toThrow()
      expect(() => PackageURL.fromString('pkg')).toThrow()
      expect(() => PackageURL.fromString('')).toThrow()

      // Test password-only authentication (no username)
      expect(() => PackageURL.fromString('pkg://:pass@type/name')).toThrow(
        'cannot contain a "user:pass@host:port"',
      )
    })

    it('should test deep freeze with array containing functions', () => {
      // Test freezing array with functions (line 33 branch for typeof item === 'function')
      const func1: any = createTestFunction('test1')
      ;(func1 as any).prop = 'value1'

      const func2: any = createTestFunction('test2')
      ;(func2 as any).nested = { data: 'nested' }

      const arr = [func1, { method: func2 }, func2, null, 'string', 42]

      const frozen = recursiveFreeze(arr)
      expect(Object.isFrozen(frozen)).toBe(true)
      // func1
      expect(Object.isFrozen(frozen[0])).toBe(true)
      // object containing func2
      expect(Object.isFrozen(frozen[1])).toBe(true)
      // func2
      expect(Object.isFrozen(frozen[2])).toBe(true)
      // func2's nested object
      expect(Object.isFrozen((frozen[2] as any).nested)).toBe(true)
    })

    it('should handle purl with type but no slash', () => {
      // Test package-url.js lines 167-168 - no slash after type
      expect(() => PackageURL.fromString('pkg:type')).toThrow(
        '"name" is a required component',
      )
    })

    it('should handle @ preceded by slash in version detection', () => {
      // Test package-url.js lines 183-189 - @ preceded by / means it's not a version separator
      // This should trigger the atSignIndex = -1 assignment on lines 188-189

      // Test with @ directly after / in the name
      const purl1 = PackageURL.fromString('pkg:type/namespace/@name')
      expect(purl1.namespace).toBe('namespace')
      expect(purl1.name).toBe('@name')
      expect(purl1.version).toBe(undefined)

      // Test with npm scoped package (common case)
      const purl2 = PackageURL.fromString('pkg:npm/@babel/core')
      expect(purl2.namespace).toBe('@babel')
      expect(purl2.name).toBe('core')
      expect(purl2.version).toBe(undefined)

      // Test with multiple @ where only the one after / should be ignored
      const purl3 = PackageURL.fromString('pkg:type/namespace/@name@1.0.0')
      expect(purl3.namespace).toBe('namespace')
      expect(purl3.name).toBe('@name')
      expect(purl3.version).toBe('1.0.0')

      // Test maven style with @ in artifact name
      const purl4 = PackageURL.fromString('pkg:maven/org.example/@artifact')
      expect(purl4.namespace).toBe('org.example')
      expect(purl4.name).toBe('@artifact')
      expect(purl4.version).toBe(undefined)
    })

    it('should handle URL parsing error', () => {
      // Test package-url.js lines 144-148 - URL parsing failure
      // We need to mock URL constructor to throw an error
      const originalURL = global.URL
      let callCount = 0

      // Mock URL to throw error
      global.URL = class MockURL {
        constructor(_url: string) {
          callCount++
          // Always throw to trigger the catch block
          throw new Error('Mocked URL error')
        }
      } as any

      try {
        expect(() => PackageURL.fromString('pkg:type/name')).toThrow(
          'failed to parse as URL',
        )
        // Make sure our mock was actually called
        expect(callCount).toBeGreaterThan(0)
      } finally {
        global.URL = originalURL
      }
    })
  })

  describe('Type-specific validation non-throwing mode', () => {
    it('should reject invalid npm package names without throwing errors', () => {
      // Test npm name starting with period (line 324-325 in purl-type.ts)
      const result1 = (PurlType.npm as any).validate(
        { name: '.hidden', namespace: '' },
        false,
      )
      expect(result1).toBe(false)

      // Test npm name starting with underscore
      const result2 = (PurlType.npm as any).validate(
        { name: '_private', namespace: '' },
        false,
      )
      expect(result2).toBe(false)

      // Test npm name that is a core module (line 424-425 in purl-type.ts)
      // Note: fs and path are legacy names, so they don't trigger the builtin check
      // Use a non-legacy builtin like worker_threads
      const result3 = (PurlType.npm as any).validate(
        { name: 'worker_threads', namespace: '' },
        false,
      )
      expect(result3).toBe(false)

      // Test npm name that's too long (line 397-398 in purl-type.ts)
      const longName = 'a'.repeat(215)
      const result4 = (PurlType.npm as any).validate(
        { name: longName, namespace: '' },
        false,
      )
      expect(result4).toBe(false)
    })

    it('should reject invalid pub package names without throwing errors', () => {
      // Test pub name with invalid characters (line 456-457 in purl-type.ts)
      const result = (PurlType.pub as any).validate(
        { name: 'invalid-name', namespace: '' },
        false,
      )
      expect(result).toBe(false)

      // Test with special characters
      const result2 = (PurlType.pub as any).validate(
        { name: 'invalid!name', namespace: '' },
        false,
      )
      expect(result2).toBe(false)

      // Test with uppercase
      const result3 = (PurlType.pub as any).validate(
        { name: 'InvalidName', namespace: '' },
        false,
      )
      expect(result3).toBe(false)
    })

    it('should reject types with illegal characters without throwing errors', () => {
      // Test validateType with illegal character (line 157-158 in validate.ts)
      const result = validateType('type!invalid', { throws: false })
      expect(result).toBe(false)

      // Test with space
      const result2 = validateType('type invalid', { throws: false })
      expect(result2).toBe(false)

      // Test with special characters
      const result3 = validateType('type@invalid', { throws: false })
      expect(result3).toBe(false)
    })

    it('should validate cocoapods name restrictions', () => {
      // Test name with whitespace
      expect(
        () => new PackageURL('cocoapods', null, 'Pod Name', null, null, null),
      ).toThrow('cocoapods "name" component cannot contain whitespace')

      // Test name with plus character
      expect(
        () => new PackageURL('cocoapods', null, 'Pod+Name', null, null, null),
      ).toThrow(
        'cocoapods "name" component cannot contain a plus (+) character',
      )

      // Test name beginning with period
      expect(
        () => new PackageURL('cocoapods', null, '.PodName', null, null, null),
      ).toThrow('cocoapods "name" component cannot begin with a period')

      // Test valid cocoapods name
      const validPurl = new PackageURL(
        'cocoapods',
        null,
        'AFNetworking',
        '4.0.0',
        null,
        null,
      )
      expect(validPurl.toString()).toBe('pkg:cocoapods/AFNetworking@4.0.0')

      // Test non-throwing mode
      const result1 = (PurlType.cocoapods as any).validate(
        { name: 'Pod Name' },
        false,
      )
      expect(result1).toBe(false)

      const result2 = (PurlType.cocoapods as any).validate(
        { name: 'Pod+Name' },
        false,
      )
      expect(result2).toBe(false)

      const result3 = (PurlType.cocoapods as any).validate(
        { name: '.PodName' },
        false,
      )
      expect(result3).toBe(false)
    })

    it('should validate cpan namespace requirements', () => {
      // Test lowercase namespace
      expect(
        () => new PackageURL('cpan', 'author', 'Module-Name', null, null, null),
      ).toThrow('cpan "namespace" component must be UPPERCASE')

      // Test mixed case namespace
      expect(
        () => new PackageURL('cpan', 'Author', 'Module-Name', null, null, null),
      ).toThrow('cpan "namespace" component must be UPPERCASE')

      // Test valid cpan with uppercase namespace
      const validPurl = new PackageURL(
        'cpan',
        'AUTHOR',
        'Module-Name',
        '1.0.0',
        null,
        null,
      )
      expect(validPurl.toString()).toBe('pkg:cpan/AUTHOR/Module-Name@1.0.0')

      // Test valid cpan without namespace (namespace is optional)
      const validPurl2 = new PackageURL(
        'cpan',
        null,
        'DateTime',
        '1.55',
        null,
        null,
      )
      expect(validPurl2.toString()).toBe('pkg:cpan/DateTime@1.55')

      // Test non-throwing mode
      const result1 = (PurlType.cpan as any).validate(
        { name: 'Module-Name', namespace: 'author' },
        false,
      )
      expect(result1).toBe(false)

      const result2 = (PurlType.cpan as any).validate(
        { name: 'Module-Name', namespace: 'Author' },
        false,
      )
      expect(result2).toBe(false)
    })

    it('should validate swid qualifier requirements', () => {
      // Test missing tag_id qualifier
      expect(
        () =>
          new PackageURL(
            'swid',
            'Acme',
            'example.com/Enterprise+Server',
            '1.0.0',
            {},
            null,
          ),
      ).toThrow('swid requires a "tag_id" qualifier')

      // Test empty tag_id (whitespace gets normalized away, so this tests missing tag_id)
      expect(
        () =>
          new PackageURL(
            'swid',
            'Acme',
            'example.com/Enterprise+Server',
            '1.0.0',
            { tag_id: '   ' },
            null,
          ),
      ).toThrow('swid requires a "tag_id" qualifier')

      // Test uppercase GUID tag_id
      expect(
        () =>
          new PackageURL(
            'swid',
            'Acme',
            'example.com/Enterprise+Server',
            '1.0.0',
            { tag_id: '75B8C285-FA7B-485B-B199-4745E3004D0D' },
            null,
          ),
      ).toThrow('swid "tag_id" qualifier must be lowercase when it is a GUID')

      // Test valid swid with lowercase GUID
      const validPurl = new PackageURL(
        'swid',
        'Acme',
        'example.com/Enterprise+Server',
        '1.0.0',
        { tag_id: '75b8c285-fa7b-485b-b199-4745e3004d0d' },
        null,
      )
      expect(validPurl.toString()).toContain(
        'pkg:swid/Acme/example.com%2FEnterprise%2BServer@1.0.0?tag_id=75b8c285-fa7b-485b-b199-4745e3004d0d',
      )

      // Test valid swid with non-GUID tag_id (mixed case allowed)
      const validPurl2 = new PackageURL(
        'swid',
        'Acme',
        'example.com/Enterprise+Server',
        '1.0.0',
        { tag_id: 'CustomTagId123' },
        null,
      )
      expect(validPurl2.toString()).toContain('tag_id=CustomTagId123')

      // Test non-throwing mode
      const result1 = (PurlType.swid as any).validate(
        { name: 'test', qualifiers: undefined },
        false,
      )
      expect(result1).toBe(false)

      const result2 = (PurlType.swid as any).validate(
        { name: 'test', qualifiers: { tag_id: '   ' } },
        false,
      )
      expect(result2).toBe(false)

      const result3 = (PurlType.swid as any).validate(
        {
          name: 'test',
          qualifiers: { tag_id: '75B8C285-FA7B-485B-B199-4745E3004D0D' },
        },
        false,
      )
      expect(result3).toBe(false)
    })
  })

  describe('Length validation', () => {
    it('should reject names exceeding maximum length', () => {
      const longName = 'x'.repeat(215)
      expect(validateName(longName, { throws: false })).toBe(false)
      expect(() => validateName(longName, { throws: true })).toThrow(
        '"name" exceeds maximum length of 214 characters',
      )
    })

    it('should accept names at maximum length', () => {
      const maxName = 'x'.repeat(214)
      expect(validateName(maxName, { throws: false })).toBe(true)
    })

    it('should reject namespaces exceeding maximum length', () => {
      const longNamespace = 'x'.repeat(513)
      expect(validateNamespace(longNamespace, { throws: false })).toBe(false)
      expect(() => validateNamespace(longNamespace, { throws: true })).toThrow(
        '"namespace" exceeds maximum length of 512 characters',
      )
    })

    it('should accept namespaces at maximum length', () => {
      const maxNamespace = 'x'.repeat(512)
      expect(validateNamespace(maxNamespace, { throws: false })).toBe(true)
    })

    it('should reject versions exceeding maximum length', () => {
      const longVersion = 'x'.repeat(257)
      expect(validateVersion(longVersion, { throws: false })).toBe(false)
      expect(() => validateVersion(longVersion, { throws: true })).toThrow(
        '"version" exceeds maximum length of 256 characters',
      )
    })

    it('should accept versions at maximum length', () => {
      const maxVersion = 'x'.repeat(256)
      expect(validateVersion(maxVersion, { throws: false })).toBe(true)
    })
  })
})
