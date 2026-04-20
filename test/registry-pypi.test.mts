/**
 * @fileoverview Tests for PyPI registry existence checks.
 */
import nock from 'nock'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createMockCache } from './utils/test-helpers.mjs'
import { pypiExists } from '../src/purl-types/pypi.js'

describe('pypiExists', () => {
  beforeEach(() => {
    nock.disableNetConnect()
  })

  afterEach(() => {
    nock.cleanAll()
    nock.enableNetConnect()
  })

  describe('package existence', () => {
    it('should return exists=true for existing package', async () => {
      nock('https://pypi.org')
        .get('/pypi/requests/json')
        .reply(200, {
          info: { version: '2.31.0' },
          releases: { '2.31.0': [] },
        })

      const result = await pypiExists('requests')

      expect(result).toEqual({
        exists: true,
        latestVersion: '2.31.0',
      })
    })

    it('should return exists=false for non-existent package', async () => {
      nock('https://pypi.org')
        .get('/pypi/this-package-does-not-exist/json')
        .reply(404)

      const result = await pypiExists('this-package-does-not-exist')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Package not found')
    })

    it('should handle package without version', async () => {
      nock('https://pypi.org')
        .get('/pypi/test-package/json')
        .reply(200, {
          releases: { '1.0.0': [] },
        })

      const result = await pypiExists('test-package')

      expect(result.exists).toBe(true)
      expect(result.latestVersion).toBeUndefined()
    })
  })

  describe('version validation', () => {
    it('should validate specific version exists', async () => {
      nock('https://pypi.org')
        .get('/pypi/django/json')
        .reply(200, {
          info: { version: '5.0.0' },
          releases: {
            '4.2.0': [],
            '5.0.0': [],
          },
        })

      const result = await pypiExists('django', '4.2.0')

      expect(result).toEqual({
        exists: true,
        latestVersion: '5.0.0',
      })
    })

    it('should return error when version does not exist', async () => {
      nock('https://pypi.org')
        .get('/pypi/django/json')
        .reply(200, {
          info: { version: '5.0.0' },
          releases: {
            '5.0.0': [],
          },
        })

      const result = await pypiExists('django', '999.0.0')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Version 999.0.0 not found')
      expect(result.latestVersion).toBe('5.0.0')
    })

    it('should handle version not found without latest version', async () => {
      nock('https://pypi.org')
        .get('/pypi/django/json')
        .reply(200, {
          releases: {
            '5.0.0': [],
          },
        })

      const result = await pypiExists('django', '999.0.0')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Version 999.0.0 not found')
      expect(result.latestVersion).toBeUndefined()
    })
  })

  describe('error handling', () => {
    it('should handle network errors', async () => {
      nock('https://pypi.org')
        .get('/pypi/test-package/json')
        .replyWithError('Network error')

      const result = await pypiExists('test-package')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('request failed')
    })

    it('should handle 500 errors', async () => {
      nock('https://pypi.org')
        .get('/pypi/test-package/json')
        .reply(500, 'Internal Server Error')

      const result = await pypiExists('test-package')

      expect(result.exists).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  describe('caching', () => {
    it('should use cached result when available', async () => {
      const mockCache = createMockCache()

      const cachedResult = { exists: true, latestVersion: '2.31.0' }
      await mockCache.set('pypi:requests', cachedResult)

      const result = await pypiExists('requests', undefined, {
        cache: mockCache,
      })

      expect(result).toEqual(cachedResult)
    })

    it('should cache result after fetching', async () => {
      const mockCache = createMockCache()

      nock('https://pypi.org')
        .get('/pypi/requests/json')
        .reply(200, {
          info: { version: '2.31.0' },
          releases: { '2.31.0': [] },
        })

      const result = await pypiExists('requests', undefined, {
        cache: mockCache,
      })

      expect(result.exists).toBe(true)
      expect(await mockCache.get('pypi:requests')).toEqual(result)
    })
  })
})
