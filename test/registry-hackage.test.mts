/**
 * @fileoverview Tests for Hackage registry existence checks.
 */
import nock from 'nock'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { hackageExists } from '../src/registry/hackage.js'

describe('hackageExists', () => {
  beforeEach(() => {
    nock.disableNetConnect()
  })

  afterEach(() => {
    nock.cleanAll()
    nock.enableNetConnect()
  })

  describe('package existence', () => {
    it('should return exists=true for existing package', async () => {
      nock('https://hackage.haskell.org')
        .get('/package/aeson/preferred')
        .reply(200, {
          'normal-version': ['2.1.0.0', '2.2.0.0'],
        })

      const result = await hackageExists('aeson')

      expect(result).toEqual({
        exists: true,
        latestVersion: '2.2.0.0',
      })
    })

    it('should return exists=false for non-existent package', async () => {
      nock('https://hackage.haskell.org')
        .get('/package/fake-package/preferred')
        .reply(404)

      const result = await hackageExists('fake-package')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Package not found')
    })

    it('should return error for empty versions array', async () => {
      nock('https://hackage.haskell.org')
        .get('/package/test-package/preferred')
        .reply(200, {
          'normal-version': [],
        })

      const result = await hackageExists('test-package')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('No versions found')
    })

    it('should handle package without normal-version field', async () => {
      nock('https://hackage.haskell.org')
        .get('/package/aeson/preferred')
        .reply(200, {})

      const result = await hackageExists('aeson')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('No versions found')
    })
  })

  describe('version validation', () => {
    it('should validate specific version exists', async () => {
      nock('https://hackage.haskell.org')
        .get('/package/aeson/preferred')
        .reply(200, {
          'normal-version': ['2.1.0.0', '2.2.0.0'],
        })

      const result = await hackageExists('aeson', '2.1.0.0')

      expect(result).toEqual({
        exists: true,
        latestVersion: '2.2.0.0',
      })
    })

    it('should return error when version does not exist', async () => {
      nock('https://hackage.haskell.org')
        .get('/package/aeson/preferred')
        .reply(200, {
          'normal-version': ['2.2.0.0'],
        })

      const result = await hackageExists('aeson', '999.0.0.0')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Version 999.0.0.0 not found')
      expect(result.latestVersion).toBe('2.2.0.0')
    })
  })

  describe('error handling', () => {
    it('should handle network errors', async () => {
      nock('https://hackage.haskell.org')
        .get('/package/test-package/preferred')
        .replyWithError('Network error')

      const result = await hackageExists('test-package')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Network error')
    })

    it('should handle 500 errors', async () => {
      nock('https://hackage.haskell.org')
        .get('/package/test-package/preferred')
        .reply(500, 'Internal Server Error')

      const result = await hackageExists('test-package')

      expect(result.exists).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  describe('caching', () => {
    it('should use cached result when available', async () => {
      const cacheData = new Map<string, unknown>()
      const mockCache = {
        get: async <T,>(key: string): Promise<T | undefined> => {
          return cacheData.get(key) as T | undefined
        },
        set: async <T,>(key: string, value: T): Promise<void> => {
          cacheData.set(key, value)
        },
      }

      const cachedResult = { exists: true, latestVersion: '2.2.0.0' }
      await mockCache.set('aeson', cachedResult)

      const result = await hackageExists('aeson', undefined, {
        cache: mockCache,
      })

      expect(result).toEqual(cachedResult)
    })

    it('should cache result after fetching', async () => {
      const cacheData = new Map<string, unknown>()
      const mockCache = {
        get: async <T,>(key: string): Promise<T | undefined> => {
          return cacheData.get(key) as T | undefined
        },
        set: async <T,>(key: string, value: T): Promise<void> => {
          cacheData.set(key, value)
        },
      }

      nock('https://hackage.haskell.org')
        .get('/package/aeson/preferred')
        .reply(200, {
          'normal-version': ['2.2.0.0'],
        })

      const result = await hackageExists('aeson', undefined, {
        cache: mockCache,
      })

      expect(result.exists).toBe(true)
      expect(cacheData.get('aeson')).toEqual(result)
    })
  })
})
