/**
 * @file Continued PackageURL tests: fromString() without pkg: prefix,
 *   comparison methods, fromNpm, fromSpec, path normalization,
 *   and input validation.
 */
import { describe, expect, it } from 'vitest'

import { PackageURL } from '../src/package-url.mjs'

describe('PackageURL (continued)', () => {
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

      for (let i = 0, { length } = testCases; i < length; i += 1) {
        const testCase = testCases[i]
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
      expect(() => PackageURL.fromNpm(undefined as unknown as string)).toThrow(
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
        'npm scoped specifier must contain "/" after scope',
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
        PackageURL.fromSpec('npm', undefined as unknown as string),
      ).toThrow('npm package specifier string is required')

      expect(() => PackageURL.fromSpec('npm', '')).toThrow(
        'npm package specifier cannot be empty',
      )

      expect(() => PackageURL.fromSpec('npm', '@babel')).toThrow(
        'npm scoped specifier must contain "/" after scope',
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
