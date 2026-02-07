/**
 * @fileoverview Tests for Packagist registry existence checks.
 */
import nock from 'nock'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { packagistExists } from '../src/registry/packagist.js'

describe('packagistExists', () => {
  beforeEach(() => {
    nock.disableNetConnect()
  })

  afterEach(() => {
    nock.cleanAll()
    nock.enableNetConnect()
  })

  describe('package existence', () => {
    it('should return exists=true for existing package', async () => {
      nock('https://repo.packagist.org')
        .get('/p2/symfony%2Fhttp-foundation.json')
        .reply(200, {
          packages: {
            'symfony/http-foundation': [
              { version: 'v6.3.0' },
              { version: 'v6.2.0' },
            ],
          },
        })

      const result = await packagistExists('http-foundation', 'symfony')

      expect(result).toEqual({
        exists: true,
        latestVersion: 'v6.3.0',
      })
    })

    it('should return exists=false for non-existent package', async () => {
      nock('https://repo.packagist.org')
        .get('/p2/vendor%2Ffake-package.json')
        .reply(404)

      const result = await packagistExists('fake-package', 'vendor')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Package not found')
    })

    it('should return error when namespace is missing', async () => {
      const result = await packagistExists('http-foundation')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Composer requires namespace')
    })

    it('should skip dev versions and find stable version', async () => {
      nock('https://repo.packagist.org')
        .get('/p2/vendor%2Fpackage.json')
        .reply(200, {
          packages: {
            'vendor/package': [{ version: 'dev-main' }, { version: 'v1.0.0' }],
          },
        })

      const result = await packagistExists('package', 'vendor')

      expect(result).toEqual({
        exists: true,
        latestVersion: 'v1.0.0',
      })
    })
  })

  describe('version validation', () => {
    it('should validate specific version exists', async () => {
      nock('https://repo.packagist.org')
        .get('/p2/symfony%2Fhttp-foundation.json')
        .reply(200, {
          packages: {
            'symfony/http-foundation': [
              { version: 'v6.3.0' },
              { version: 'v6.2.0' },
            ],
          },
        })

      const result = await packagistExists(
        'http-foundation',
        'symfony',
        'v6.2.0',
      )

      expect(result).toEqual({
        exists: true,
        latestVersion: 'v6.3.0',
      })
    })

    it('should return error when version does not exist', async () => {
      nock('https://repo.packagist.org')
        .get('/p2/symfony%2Fhttp-foundation.json')
        .reply(200, {
          packages: {
            'symfony/http-foundation': [{ version: 'v6.3.0' }],
          },
        })

      const result = await packagistExists(
        'http-foundation',
        'symfony',
        'v999.0.0',
      )

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Version v999.0.0 not found')
      expect(result.latestVersion).toBe('v6.3.0')
    })
  })

  describe('error handling', () => {
    it('should handle network errors', async () => {
      nock('https://repo.packagist.org')
        .get('/p2/vendor%2Fpackage.json')
        .replyWithError('Network error')

      const result = await packagistExists('package', 'vendor')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Network error')
    })

    it('should handle 500 errors', async () => {
      nock('https://repo.packagist.org')
        .get('/p2/vendor%2Fpackage.json')
        .reply(500, 'Internal Server Error')

      const result = await packagistExists('package', 'vendor')

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

      const cachedResult = { exists: true, latestVersion: 'v6.3.0' }
      await mockCache.set('symfony/http-foundation', cachedResult)

      const result = await packagistExists(
        'http-foundation',
        'symfony',
        undefined,
        { cache: mockCache },
      )

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

      nock('https://repo.packagist.org')
        .get('/p2/symfony%2Fhttp-foundation.json')
        .reply(200, {
          packages: {
            'symfony/http-foundation': [{ version: 'v6.3.0' }],
          },
        })

      const result = await packagistExists(
        'http-foundation',
        'symfony',
        undefined,
        { cache: mockCache },
      )

      expect(result.exists).toBe(true)
      expect(cacheData.get('symfony/http-foundation')).toEqual(result)
    })
  })
})
