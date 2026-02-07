/**
 * @fileoverview Tests for CocoaPods registry existence checks.
 */
import nock from 'nock'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { cocoapodsExists } from '../src/registry/cocoapods.js'

describe('cocoapodsExists', () => {
  beforeEach(() => {
    nock.disableNetConnect()
  })

  afterEach(() => {
    nock.cleanAll()
    nock.enableNetConnect()
  })

  describe('pod existence', () => {
    it('should return exists=true for existing pod', async () => {
      nock('https://trunk.cocoapods.org')
        .get('/api/v1/pods/Alamofire')
        .reply(200, {
          versions: [{ name: '5.8.1' }, { name: '5.8.0' }],
        })

      const result = await cocoapodsExists('Alamofire')

      expect(result).toEqual({
        exists: true,
        latestVersion: '5.8.1',
      })
    })

    it('should return exists=false for non-existent pod', async () => {
      nock('https://trunk.cocoapods.org').get('/api/v1/pods/FakePod').reply(404)

      const result = await cocoapodsExists('FakePod')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Pod not found')
    })

    it('should return error for empty versions array', async () => {
      nock('https://trunk.cocoapods.org')
        .get('/api/v1/pods/TestPod')
        .reply(200, { versions: [] })

      const result = await cocoapodsExists('TestPod')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('No versions found')
    })

    it('should handle pod without versions field', async () => {
      nock('https://trunk.cocoapods.org')
        .get('/api/v1/pods/TestPod')
        .reply(200, {})

      const result = await cocoapodsExists('TestPod')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('No versions found')
    })

    it('should handle pod without latest version name', async () => {
      nock('https://trunk.cocoapods.org')
        .get('/api/v1/pods/TestPod')
        .reply(200, {
          versions: [{}],
        })

      const result = await cocoapodsExists('TestPod')

      expect(result.exists).toBe(true)
      expect(result.latestVersion).toBeUndefined()
    })
  })

  describe('version validation', () => {
    it('should validate specific version exists', async () => {
      nock('https://trunk.cocoapods.org')
        .get('/api/v1/pods/Alamofire')
        .reply(200, {
          versions: [{ name: '5.8.1' }, { name: '5.8.0' }],
        })

      const result = await cocoapodsExists('Alamofire', '5.8.0')

      expect(result).toEqual({
        exists: true,
        latestVersion: '5.8.1',
      })
    })

    it('should return error when version does not exist', async () => {
      nock('https://trunk.cocoapods.org')
        .get('/api/v1/pods/Alamofire')
        .reply(200, {
          versions: [{ name: '5.8.1' }],
        })

      const result = await cocoapodsExists('Alamofire', '999.0.0')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Version 999.0.0 not found')
      expect(result.latestVersion).toBe('5.8.1')
    })
  })

  describe('error handling', () => {
    it('should handle network errors', async () => {
      nock('https://trunk.cocoapods.org')
        .get('/api/v1/pods/TestPod')
        .replyWithError('Network error')

      const result = await cocoapodsExists('TestPod')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Network error')
    })

    it('should handle 500 errors', async () => {
      nock('https://trunk.cocoapods.org')
        .get('/api/v1/pods/TestPod')
        .reply(500, 'Internal Server Error')

      const result = await cocoapodsExists('TestPod')

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

      const cachedResult = { exists: true, latestVersion: '5.8.1' }
      await mockCache.set('Alamofire', cachedResult)

      const result = await cocoapodsExists('Alamofire', undefined, {
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

      nock('https://trunk.cocoapods.org')
        .get('/api/v1/pods/Alamofire')
        .reply(200, {
          versions: [{ name: '5.8.1' }],
        })

      const result = await cocoapodsExists('Alamofire', undefined, {
        cache: mockCache,
      })

      expect(result.exists).toBe(true)
      expect(cacheData.get('Alamofire')).toEqual(result)
    })
  })
})
