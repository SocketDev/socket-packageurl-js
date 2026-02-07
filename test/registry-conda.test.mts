/**
 * @fileoverview Tests for conda registry existence checks.
 */
import nock from 'nock'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createMockCache } from './utils/test-helpers.mjs'
import { condaExists } from '../src/purl-types/conda.js'

describe('condaExists', () => {
  beforeEach(() => {
    nock.disableNetConnect()
  })

  afterEach(() => {
    nock.cleanAll()
    nock.enableNetConnect()
  })

  describe('package existence', () => {
    it('should return exists=true for existing package', async () => {
      nock('https://api.anaconda.org')
        .get('/package/conda-forge/numpy')
        .reply(200, {
          latest_version: '1.26.3',
          versions: ['1.26.3', '1.26.2', '1.26.1'],
        })

      const result = await condaExists('numpy')

      expect(result).toEqual({
        exists: true,
        latestVersion: '1.26.3',
      })
    })

    it('should return exists=false for non-existent package', async () => {
      nock('https://api.anaconda.org')
        .get('/package/conda-forge/this-package-does-not-exist')
        .reply(404)

      const result = await condaExists('this-package-does-not-exist')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Package not found')
    })

    it('should handle package without latest_version', async () => {
      nock('https://api.anaconda.org')
        .get('/package/conda-forge/test-package')
        .reply(200, {
          versions: ['1.0.0'],
        })

      const result = await condaExists('test-package')

      expect(result.exists).toBe(true)
      expect(result.latestVersion).toBeUndefined()
    })

    it('should use custom channel when specified', async () => {
      nock('https://api.anaconda.org')
        .get('/package/defaults/python')
        .reply(200, {
          latest_version: '3.11.0',
          versions: ['3.11.0', '3.10.0'],
        })

      const result = await condaExists('python', undefined, 'defaults')

      expect(result).toEqual({
        exists: true,
        latestVersion: '3.11.0',
      })
    })

    it('should default to conda-forge channel', async () => {
      nock('https://api.anaconda.org')
        .get('/package/conda-forge/pandas')
        .reply(200, {
          latest_version: '2.2.0',
          versions: ['2.2.0'],
        })

      const result = await condaExists('pandas')

      expect(result.exists).toBe(true)
      expect(result.latestVersion).toBe('2.2.0')
    })
  })

  describe('version validation', () => {
    it('should validate specific version exists', async () => {
      nock('https://api.anaconda.org')
        .get('/package/conda-forge/numpy')
        .reply(200, {
          latest_version: '1.26.3',
          versions: ['1.26.3', '1.26.2', '1.26.1'],
        })

      const result = await condaExists('numpy', '1.26.2')

      expect(result).toEqual({
        exists: true,
        latestVersion: '1.26.3',
      })
    })

    it('should return error when version does not exist', async () => {
      nock('https://api.anaconda.org')
        .get('/package/conda-forge/numpy')
        .reply(200, {
          latest_version: '1.26.3',
          versions: ['1.26.3', '1.26.2'],
        })

      const result = await condaExists('numpy', '999.0.0')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Version 999.0.0 not found')
      expect(result.latestVersion).toBe('1.26.3')
    })

    it('should validate version in custom channel', async () => {
      nock('https://api.anaconda.org')
        .get('/package/anaconda/scipy')
        .reply(200, {
          latest_version: '1.11.4',
          versions: ['1.11.4', '1.11.3'],
        })

      const result = await condaExists('scipy', '1.11.3', 'anaconda')

      expect(result.exists).toBe(true)
      expect(result.latestVersion).toBe('1.11.4')
    })
  })

  describe('error handling', () => {
    it('should handle network errors', async () => {
      nock('https://api.anaconda.org')
        .get('/package/conda-forge/test-package')
        .replyWithError('Network error')

      const result = await condaExists('test-package')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Network error')
    })

    it('should handle 500 errors', async () => {
      nock('https://api.anaconda.org')
        .get('/package/conda-forge/test-package')
        .reply(500, 'Internal Server Error')

      const result = await condaExists('test-package')

      expect(result.exists).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('should handle missing versions array', async () => {
      nock('https://api.anaconda.org')
        .get('/package/conda-forge/numpy')
        .reply(200, {
          latest_version: '1.26.3',
        })

      const result = await condaExists('numpy', '1.26.2')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Version 1.26.2 not found')
    })
  })

  describe('caching', () => {
    it('should work without cache option', async () => {
      nock('https://api.anaconda.org')
        .get('/package/conda-forge/numpy')
        .reply(200, {
          latest_version: '1.26.3',
          versions: ['1.26.3'],
        })

      const result = await condaExists('numpy')

      expect(result.exists).toBe(true)
    })

    it('should use cached result when available', async () => {
      const mockCache = createMockCache()

      // Pre-populate cache
      const cachedResult = { exists: true, latestVersion: '1.26.3' }
      await mockCache.set('conda-forge/numpy', cachedResult)

      // Should not make HTTP request
      const result = await condaExists('numpy', undefined, undefined, {
        cache: mockCache,
      })

      expect(result).toEqual(cachedResult)
    })

    it('should cache the result after fetching', async () => {
      const mockCache = createMockCache()

      nock('https://api.anaconda.org')
        .get('/package/conda-forge/pandas')
        .reply(200, {
          latest_version: '2.2.0',
          versions: ['2.2.0'],
        })

      const result = await condaExists('pandas', undefined, undefined, {
        cache: mockCache,
      })

      expect(result.exists).toBe(true)

      // Verify cached
      const cached = await mockCache.get('conda-forge/pandas')
      expect(cached).toEqual(result)
    })

    it('should include version in cache key', async () => {
      const mockCache = createMockCache()

      nock('https://api.anaconda.org')
        .get('/package/conda-forge/numpy')
        .reply(200, {
          latest_version: '1.26.3',
          versions: ['1.26.3', '1.26.2'],
        })

      await condaExists('numpy', '1.26.2', undefined, { cache: mockCache })

      expect(await mockCache.get('conda-forge/numpy@1.26.2')).toBeDefined()
    })

    it('should include channel in cache key', async () => {
      const mockCache = createMockCache()

      nock('https://api.anaconda.org')
        .get('/package/defaults/python')
        .reply(200, {
          latest_version: '3.11.0',
          versions: ['3.11.0'],
        })

      await condaExists('python', undefined, 'defaults', { cache: mockCache })

      expect(await mockCache.get('defaults/python')).toBeDefined()
    })
  })
})
