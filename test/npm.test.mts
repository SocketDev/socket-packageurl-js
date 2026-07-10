/**
 * @file Tests for npm registry existence checks and npm specifier parsing.
 */
import nock from 'nock'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createMockCache } from './utils/test-helpers.mjs'
import { npmExists, parseNpmSpecifier } from '../src/purl-types/npm.mjs'

describe('npmExists', () => {
  beforeEach(() => {
    nock.disableNetConnect()
  })

  afterEach(() => {
    nock.cleanAll()
    nock.enableNetConnect()
  })

  describe('package existence', () => {
    it('should return exists=true for existing package', async () => {
      nock('https://registry.npmjs.org')
        .get('/lodash')
        .reply(200, {
          'dist-tags': { latest: '4.17.21' },
          versions: { '4.17.21': {} },
        })

      const result = await npmExists('lodash')

      expect(result).toEqual({
        exists: true,
        latestVersion: '4.17.21',
      })
    })

    it('should return exists=false for non-existent package', async () => {
      nock('https://registry.npmjs.org')
        .get('/this-package-does-not-exist')
        .reply(404)

      const result = await npmExists('this-package-does-not-exist')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Package not found')
    })

    it('should handle scoped packages', async () => {
      nock('https://registry.npmjs.org')
        .get('/%40babel%2Fcore')
        .reply(200, {
          'dist-tags': { latest: '7.23.0' },
          versions: { '7.23.0': {} },
        })

      const result = await npmExists('core', '@babel')

      expect(result).toEqual({
        exists: true,
        latestVersion: '7.23.0',
      })
    })

    it('should handle package without latest tag', async () => {
      nock('https://registry.npmjs.org')
        .get('/test-package')
        .reply(200, {
          versions: { '1.0.0': {} },
        })

      const result = await npmExists('test-package')

      expect(result.exists).toBe(true)
      expect(result.latestVersion).toBeUndefined()
    })
  })

  describe('version validation', () => {
    it('should validate specific version exists', async () => {
      nock('https://registry.npmjs.org')
        .get('/lodash')
        .reply(200, {
          'dist-tags': { latest: '4.17.21' },
          versions: {
            '4.17.20': {},
            '4.17.21': {},
          },
        })

      const result = await npmExists('lodash', undefined, '4.17.20')

      expect(result).toEqual({
        exists: true,
        latestVersion: '4.17.21',
      })
    })

    it('should return error when version does not exist', async () => {
      nock('https://registry.npmjs.org')
        .get('/lodash')
        .reply(200, {
          'dist-tags': { latest: '4.17.21' },
          versions: {
            '4.17.21': {},
          },
        })

      const result = await npmExists('lodash', undefined, '999.0.0')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Version 999.0.0 not found')
      expect(result.latestVersion).toBe('4.17.21')
    })
  })

  describe('error handling', () => {
    it('should handle network errors', async () => {
      nock('https://registry.npmjs.org')
        .get('/test-package')
        .replyWithError('Network error')

      const result = await npmExists('test-package')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('request failed')
    })

    it('should handle 500 errors', async () => {
      nock('https://registry.npmjs.org')
        .get('/test-package')
        .reply(500, 'Internal Server Error')

      const result = await npmExists('test-package')

      expect(result.exists).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  describe('caching', () => {
    it('should work without cache option', async () => {
      nock('https://registry.npmjs.org')
        .get('/lodash')
        .reply(200, {
          'dist-tags': { latest: '4.17.21' },
          versions: { '4.17.21': {} },
        })

      const result = await npmExists('lodash')

      expect(result.exists).toBe(true)
    })

    it('should use cached result when available', async () => {
      const mockCache = createMockCache()

      // Pre-populate cache
      const cachedResult = { exists: true, latestVersion: '4.17.21' }
      await mockCache.set('npm:lodash', cachedResult)

      // Should NOT make HTTP request
      const result = await npmExists('lodash', undefined, undefined, {
        cache: mockCache,
      })

      expect(result).toEqual(cachedResult)
    })

    it('should cache result after fetching', async () => {
      const mockCache = createMockCache()

      nock('https://registry.npmjs.org')
        .get('/lodash')
        .reply(200, {
          'dist-tags': { latest: '4.17.21' },
          versions: { '4.17.21': {} },
        })

      const result = await npmExists('lodash', undefined, undefined, {
        cache: mockCache,
      })

      expect(result.exists).toBe(true)
      expect(await mockCache.get('npm:lodash')).toEqual(result)
    })

    it('should use correct cache key for scoped packages', async () => {
      const mockCache = createMockCache()

      nock('https://registry.npmjs.org')
        .get('/%40babel%2Fcore')
        .reply(200, {
          'dist-tags': { latest: '7.23.0' },
          versions: { '7.23.0': {} },
        })

      await npmExists('core', '@babel', undefined, { cache: mockCache })

      expect(await mockCache.get('npm:@babel/core')).toBeDefined()
    })

    it('should use correct cache key with version', async () => {
      const mockCache = createMockCache()

      nock('https://registry.npmjs.org')
        .get('/lodash')
        .reply(200, {
          'dist-tags': { latest: '4.17.21' },
          versions: { '4.17.20': {}, '4.17.21': {} },
        })

      await npmExists('lodash', undefined, '4.17.20', { cache: mockCache })

      expect(await mockCache.get('npm:lodash@4.17.20')).toBeDefined()
    })

    it('should not cache error results (prevents negative cache poisoning)', async () => {
      const mockCache = createMockCache()

      nock('https://registry.npmjs.org').get('/nonexistent').reply(404)

      const result = await npmExists('nonexistent', undefined, undefined, {
        cache: mockCache,
      })

      expect(result.exists).toBe(false)
      expect(await mockCache.get('npm:nonexistent')).toBeUndefined()
    })
  })
})

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
      expect(() => parseNpmSpecifier(undefined as unknown as string)).toThrow(
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
        'npm scoped specifier must contain "/" after scope',
      )
    })

    it('should throw on invalid scoped package (only @ symbol)', () => {
      expect(() => parseNpmSpecifier('@')).toThrow(
        'npm scoped specifier must contain "/" after scope',
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
