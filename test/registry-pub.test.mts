/**
 * @fileoverview Tests for Pub registry existence checks.
 */
import nock from 'nock'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createMockCache } from './utils/test-helpers.mjs'
import { pubExists } from '../src/purl-types/pub.js'

describe('pubExists', () => {
  beforeEach(() => {
    nock.disableNetConnect()
  })

  afterEach(() => {
    nock.cleanAll()
    nock.enableNetConnect()
  })

  describe('package existence', () => {
    it('should return exists=true for existing package', async () => {
      nock('https://pub.dev')
        .get('/api/packages/flutter_bloc')
        .reply(200, {
          latest: { version: '8.1.3' },
          versions: [{ version: '8.1.3' }, { version: '8.1.2' }],
        })

      const result = await pubExists('flutter_bloc')

      expect(result).toEqual({
        exists: true,
        latestVersion: '8.1.3',
      })
    })

    it('should return exists=false for non-existent package', async () => {
      nock('https://pub.dev').get('/api/packages/fake_package').reply(404)

      const result = await pubExists('fake_package')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Package not found')
    })

    it('should handle package without latest version field', async () => {
      nock('https://pub.dev')
        .get('/api/packages/flutter_bloc')
        .reply(200, {
          versions: [{ version: '8.1.3' }],
        })

      const result = await pubExists('flutter_bloc')

      expect(result.exists).toBe(true)
      expect(result.latestVersion).toBeUndefined()
    })
  })

  describe('version validation', () => {
    it('should validate specific version exists', async () => {
      nock('https://pub.dev')
        .get('/api/packages/flutter_bloc')
        .reply(200, {
          latest: { version: '8.1.3' },
          versions: [{ version: '8.1.3' }, { version: '8.1.2' }],
        })

      const result = await pubExists('flutter_bloc', '8.1.2')

      expect(result).toEqual({
        exists: true,
        latestVersion: '8.1.3',
      })
    })

    it('should return error when version does not exist', async () => {
      nock('https://pub.dev')
        .get('/api/packages/flutter_bloc')
        .reply(200, {
          latest: { version: '8.1.3' },
          versions: [{ version: '8.1.3' }],
        })

      const result = await pubExists('flutter_bloc', '999.0.0')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Version 999.0.0 not found')
      expect(result.latestVersion).toBe('8.1.3')
    })

    it('should return version not found without latestVersion when latest field is missing', async () => {
      nock('https://pub.dev')
        .get('/api/packages/flutter_bloc')
        .reply(200, {
          versions: [{ version: '8.1.3' }],
        })

      const result = await pubExists('flutter_bloc', '999.0.0')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Version 999.0.0 not found')
      expect(result.latestVersion).toBeUndefined()
    })

    it('should handle version check when versions array is missing', async () => {
      nock('https://pub.dev')
        .get('/api/packages/flutter_bloc')
        .reply(200, {
          latest: { version: '8.1.3' },
        })

      const result = await pubExists('flutter_bloc', '999.0.0')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Version 999.0.0 not found')
      expect(result.latestVersion).toBe('8.1.3')
    })
  })

  describe('error handling', () => {
    it('should handle network errors', async () => {
      nock('https://pub.dev')
        .get('/api/packages/test_package')
        .replyWithError('Network error')

      const result = await pubExists('test_package')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('request failed')
    })

    it('should handle 500 errors', async () => {
      nock('https://pub.dev')
        .get('/api/packages/test_package')
        .reply(500, 'Internal Server Error')

      const result = await pubExists('test_package')

      expect(result.exists).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  describe('caching', () => {
    it('should use cached result when available', async () => {
      const mockCache = createMockCache()

      const cachedResult = { exists: true, latestVersion: '8.1.3' }
      await mockCache.set('flutter_bloc', cachedResult)

      const result = await pubExists('flutter_bloc', undefined, {
        cache: mockCache,
      })

      expect(result).toEqual(cachedResult)
    })

    it('should cache result after fetching', async () => {
      const mockCache = createMockCache()

      nock('https://pub.dev')
        .get('/api/packages/flutter_bloc')
        .reply(200, {
          latest: { version: '8.1.3' },
          versions: [{ version: '8.1.3' }],
        })

      const result = await pubExists('flutter_bloc', undefined, {
        cache: mockCache,
      })

      expect(result.exists).toBe(true)
      expect(await mockCache.get('flutter_bloc')).toEqual(result)
    })
  })
})
