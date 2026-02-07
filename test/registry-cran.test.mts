/**
 * @fileoverview Tests for CRAN registry existence checks.
 */
import nock from 'nock'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createMockCache } from './utils/test-helpers.mjs'
import { cranExists } from '../src/purl-types/cran.js'

describe('cranExists', () => {
  beforeEach(() => {
    nock.disableNetConnect()
  })

  afterEach(() => {
    nock.cleanAll()
    nock.enableNetConnect()
  })

  describe('package existence', () => {
    it('should return exists=true for existing package', async () => {
      nock('https://cran.r-universe.dev')
        .get('/api/packages/ggplot2')
        .reply(200, {
          Version: '3.4.4',
          versions: ['3.4.4', '3.4.3', '3.4.2'],
        })

      const result = await cranExists('ggplot2')

      expect(result).toEqual({
        exists: true,
        latestVersion: '3.4.4',
      })
    })

    it('should return exists=false for non-existent package', async () => {
      nock('https://cran.r-universe.dev')
        .get('/api/packages/FakePackage')
        .reply(404)

      const result = await cranExists('FakePackage')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Package not found')
    })

    it('should handle package without Version field', async () => {
      nock('https://cran.r-universe.dev')
        .get('/api/packages/ggplot2')
        .reply(200, {
          versions: ['3.4.4'],
        })

      const result = await cranExists('ggplot2')

      expect(result.exists).toBe(true)
      expect(result.latestVersion).toBeUndefined()
    })
  })

  describe('version validation', () => {
    it('should validate specific version exists', async () => {
      nock('https://cran.r-universe.dev')
        .get('/api/packages/ggplot2')
        .reply(200, {
          Version: '3.4.4',
          versions: ['3.4.4', '3.4.3', '3.4.2'],
        })

      const result = await cranExists('ggplot2', '3.4.3')

      expect(result).toEqual({
        exists: true,
        latestVersion: '3.4.4',
      })
    })

    it('should return error when version does not exist', async () => {
      nock('https://cran.r-universe.dev')
        .get('/api/packages/ggplot2')
        .reply(200, {
          Version: '3.4.4',
          versions: ['3.4.4'],
        })

      const result = await cranExists('ggplot2', '999.0.0')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Version 999.0.0 not found')
      expect(result.latestVersion).toBe('3.4.4')
    })
  })

  describe('error handling', () => {
    it('should handle network errors', async () => {
      nock('https://cran.r-universe.dev')
        .get('/api/packages/TestPackage')
        .replyWithError('Network error')

      const result = await cranExists('TestPackage')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Network error')
    })

    it('should handle 500 errors', async () => {
      nock('https://cran.r-universe.dev')
        .get('/api/packages/TestPackage')
        .reply(500, 'Internal Server Error')

      const result = await cranExists('TestPackage')

      expect(result.exists).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  describe('caching', () => {
    it('should use cached result when available', async () => {
      const mockCache = createMockCache()

      const cachedResult = { exists: true, latestVersion: '3.4.4' }
      await mockCache.set('ggplot2', cachedResult)

      const result = await cranExists('ggplot2', undefined, {
        cache: mockCache,
      })

      expect(result).toEqual(cachedResult)
    })

    it('should cache result after fetching', async () => {
      const mockCache = createMockCache()

      nock('https://cran.r-universe.dev')
        .get('/api/packages/ggplot2')
        .reply(200, {
          Version: '3.4.4',
          versions: ['3.4.4'],
        })

      const result = await cranExists('ggplot2', undefined, {
        cache: mockCache,
      })

      expect(result.exists).toBe(true)
      expect(await mockCache.get('ggplot2')).toEqual(result)
    })
  })
})
