/**
 * @fileoverview Tests for parseNpmSpecifier standalone function
 */

import { describe, expect, it } from 'vitest'

import { parseNpmSpecifier } from '../src/parsers/npm.js'

describe('parseNpmSpecifier', () => {
  describe('basic package parsing', () => {
    it('should parse basic npm package without version', () => {
      const result = parseNpmSpecifier('lodash')
      expect(result).toEqual({
        namespace: undefined,
        name: 'lodash',
        version: undefined,
      })
    })

    it('should parse npm package with version', () => {
      const result = parseNpmSpecifier('lodash@4.17.21')
      expect(result).toEqual({
        namespace: undefined,
        name: 'lodash',
        version: '4.17.21',
      })
    })
  })

  describe('scoped package parsing', () => {
    it('should parse scoped npm package without version', () => {
      const result = parseNpmSpecifier('@babel/core')
      expect(result).toEqual({
        namespace: '@babel',
        name: 'core',
        version: undefined,
      })
    })

    it('should parse scoped npm package with version', () => {
      const result = parseNpmSpecifier('@babel/core@7.20.0')
      expect(result).toEqual({
        namespace: '@babel',
        name: 'core',
        version: '7.20.0',
      })
    })

    it('should parse scoped package with complex version', () => {
      const result = parseNpmSpecifier('@types/node@18.11.9')
      expect(result).toEqual({
        namespace: '@types',
        name: 'node',
        version: '18.11.9',
      })
    })
  })

  describe('version range handling', () => {
    it('should strip caret prefix from version', () => {
      const result = parseNpmSpecifier('lodash@^4.17.21')
      expect(result).toEqual({
        namespace: undefined,
        name: 'lodash',
        version: '4.17.21',
      })
    })

    it('should strip tilde prefix from version', () => {
      const result = parseNpmSpecifier('lodash@~4.17.21')
      expect(result).toEqual({
        namespace: undefined,
        name: 'lodash',
        version: '4.17.21',
      })
    })

    it('should strip >= prefix from version', () => {
      const result = parseNpmSpecifier('lodash@>=4.17.21')
      expect(result).toEqual({
        namespace: undefined,
        name: 'lodash',
        version: '4.17.21',
      })
    })

    it('should strip <= prefix from version', () => {
      const result = parseNpmSpecifier('lodash@<=4.17.21')
      expect(result).toEqual({
        namespace: undefined,
        name: 'lodash',
        version: '4.17.21',
      })
    })

    it('should strip > prefix from version', () => {
      const result = parseNpmSpecifier('lodash@>4.17.21')
      expect(result).toEqual({
        namespace: undefined,
        name: 'lodash',
        version: '4.17.21',
      })
    })

    it('should strip < prefix from version', () => {
      const result = parseNpmSpecifier('lodash@<4.17.21')
      expect(result).toEqual({
        namespace: undefined,
        name: 'lodash',
        version: '4.17.21',
      })
    })

    it('should strip = prefix from version', () => {
      const result = parseNpmSpecifier('lodash@=4.17.21')
      expect(result).toEqual({
        namespace: undefined,
        name: 'lodash',
        version: '4.17.21',
      })
    })

    it('should handle version ranges by taking first version', () => {
      const result = parseNpmSpecifier('lodash@1.0.0 - 2.0.0')
      expect(result).toEqual({
        namespace: undefined,
        name: 'lodash',
        version: '1.0.0',
      })
    })

    it('should handle multiple range prefixes', () => {
      const result = parseNpmSpecifier('react@>=16.8.0')
      expect(result).toEqual({
        namespace: undefined,
        name: 'react',
        version: '16.8.0',
      })
    })
  })

  describe('dist-tag support', () => {
    it('should support latest dist-tag', () => {
      const result = parseNpmSpecifier('react@latest')
      expect(result).toEqual({
        namespace: undefined,
        name: 'react',
        version: 'latest',
      })
    })

    it('should support next dist-tag', () => {
      const result = parseNpmSpecifier('@babel/core@next')
      expect(result).toEqual({
        namespace: '@babel',
        name: 'core',
        version: 'next',
      })
    })

    it('should support beta dist-tag', () => {
      const result = parseNpmSpecifier('webpack@beta')
      expect(result).toEqual({
        namespace: undefined,
        name: 'webpack',
        version: 'beta',
      })
    })

    it('should support custom dist-tags', () => {
      const result = parseNpmSpecifier('my-package@canary')
      expect(result).toEqual({
        namespace: undefined,
        name: 'my-package',
        version: 'canary',
      })
    })
  })

  describe('error handling', () => {
    it('should throw on null input', () => {
      expect(() => parseNpmSpecifier(null as unknown as string)).toThrow(
        'npm package specifier string is required.',
      )
    })

    it('should throw on undefined input', () => {
      expect(() => parseNpmSpecifier(undefined as unknown as string)).toThrow(
        'npm package specifier string is required.',
      )
    })

    it('should throw on number input', () => {
      expect(() => parseNpmSpecifier(123 as unknown as string)).toThrow(
        'npm package specifier string is required.',
      )
    })

    it('should throw on object input', () => {
      expect(() => parseNpmSpecifier({} as unknown as string)).toThrow(
        'npm package specifier string is required.',
      )
    })

    it('should throw on empty string', () => {
      expect(() => parseNpmSpecifier('')).toThrow(
        'npm package specifier cannot be empty.',
      )
    })

    it('should throw on whitespace-only string', () => {
      expect(() => parseNpmSpecifier('   ')).toThrow(
        'npm package specifier cannot be empty.',
      )
    })

    it('should throw on invalid scoped package (missing slash)', () => {
      expect(() => parseNpmSpecifier('@babel')).toThrow(
        'Invalid scoped package specifier.',
      )
    })

    it('should throw on invalid scoped package (only @ symbol)', () => {
      expect(() => parseNpmSpecifier('@')).toThrow(
        'Invalid scoped package specifier.',
      )
    })
  })

  describe('edge cases', () => {
    it('should handle package names with hyphens', () => {
      const result = parseNpmSpecifier('my-awesome-package@1.0.0')
      expect(result).toEqual({
        namespace: undefined,
        name: 'my-awesome-package',
        version: '1.0.0',
      })
    })

    it('should handle scoped packages with hyphens', () => {
      const result = parseNpmSpecifier('@my-org/my-package@1.0.0')
      expect(result).toEqual({
        namespace: '@my-org',
        name: 'my-package',
        version: '1.0.0',
      })
    })

    it('should handle complex version strings', () => {
      const result = parseNpmSpecifier('package@1.2.3-alpha.1+build.123')
      expect(result).toEqual({
        namespace: undefined,
        name: 'package',
        version: '1.2.3-alpha.1+build.123',
      })
    })

    it('should handle version range with multiple spaces', () => {
      const result = parseNpmSpecifier('foo@1.0.0   -   2.0.0')
      expect(result).toEqual({
        namespace: undefined,
        name: 'foo',
        version: '1.0.0',
      })
    })
  })
})
