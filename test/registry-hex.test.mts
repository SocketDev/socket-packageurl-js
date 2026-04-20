/**
 * @fileoverview Tests for Hex registry existence checks.
 */
import nock from 'nock'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createMockCache } from './utils/test-helpers.mjs'
import { hexExists } from '../src/purl-types/hex.js'

describe('hexExists', () => {
  beforeEach(() => {
    nock.disableNetConnect()
  })

  afterEach(() => {
    nock.cleanAll()
    nock.enableNetConnect()
  })

  describe('package existence', () => {
    it('should return exists=true for existing package', async () => {
      nock('https://hex.pm')
        .get('/api/packages/phoenix')
        .reply(200, {
          latest_version: '1.7.10',
          releases: [{ version: '1.7.10' }, { version: '1.7.9' }],
        })

      const result = await hexExists('phoenix')

      expect(result).toEqual({
        exists: true,
        latestVersion: '1.7.10',
      })
    })

    it('should return exists=false for non-existent package', async () => {
      nock('https://hex.pm').get('/api/packages/fake_package').reply(404)

      const result = await hexExists('fake_package')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Package not found')
    })

    it('should handle package without latest_version field', async () => {
      nock('https://hex.pm')
        .get('/api/packages/phoenix')
        .reply(200, {
          releases: [{ version: '1.7.10' }],
        })

      const result = await hexExists('phoenix')

      expect(result.exists).toBe(true)
      expect(result.latestVersion).toBeUndefined()
    })
  })

  describe('version validation', () => {
    it('should validate specific version exists', async () => {
      nock('https://hex.pm')
        .get('/api/packages/phoenix')
        .reply(200, {
          latest_version: '1.7.10',
          releases: [{ version: '1.7.10' }, { version: '1.7.9' }],
        })

      const result = await hexExists('phoenix', '1.7.9')

      expect(result).toEqual({
        exists: true,
        latestVersion: '1.7.10',
      })
    })

    it('should return error when version does not exist', async () => {
      nock('https://hex.pm')
        .get('/api/packages/phoenix')
        .reply(200, {
          latest_version: '1.7.10',
          releases: [{ version: '1.7.10' }],
        })

      const result = await hexExists('phoenix', '999.0.0')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Version 999.0.0 not found')
      expect(result.latestVersion).toBe('1.7.10')
    })

    it('should return version not found without latestVersion when latest_version field is missing', async () => {
      nock('https://hex.pm')
        .get('/api/packages/phoenix')
        .reply(200, {
          releases: [{ version: '1.7.10' }],
        })

      const result = await hexExists('phoenix', '999.0.0')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Version 999.0.0 not found')
      expect(result.latestVersion).toBeUndefined()
    })

    it('should handle version check when releases array is missing', async () => {
      nock('https://hex.pm').get('/api/packages/phoenix').reply(200, {
        latest_version: '1.7.10',
      })

      const result = await hexExists('phoenix', '999.0.0')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Version 999.0.0 not found')
      expect(result.latestVersion).toBe('1.7.10')
    })
  })

  describe('error handling', () => {
    it('should handle network errors', async () => {
      nock('https://hex.pm')
        .get('/api/packages/test_package')
        .replyWithError('Network error')

      const result = await hexExists('test_package')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('request failed')
    })

    it('should handle 500 errors', async () => {
      nock('https://hex.pm')
        .get('/api/packages/test_package')
        .reply(500, 'Internal Server Error')

      const result = await hexExists('test_package')

      expect(result.exists).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  describe('caching', () => {
    it('should use cached result when available', async () => {
      const mockCache = createMockCache()

      const cachedResult = { exists: true, latestVersion: '1.7.10' }
      await mockCache.set('hex:phoenix', cachedResult)

      const result = await hexExists('phoenix', undefined, {
        cache: mockCache,
      })

      expect(result).toEqual(cachedResult)
    })

    it('should cache result after fetching', async () => {
      const mockCache = createMockCache()

      nock('https://hex.pm')
        .get('/api/packages/phoenix')
        .reply(200, {
          latest_version: '1.7.10',
          releases: [{ version: '1.7.10' }],
        })

      const result = await hexExists('phoenix', undefined, {
        cache: mockCache,
      })

      expect(result.exists).toBe(true)
      expect(await mockCache.get('hex:phoenix')).toEqual(result)
    })
  })
})
