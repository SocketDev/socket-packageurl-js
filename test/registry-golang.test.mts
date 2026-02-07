/**
 * @fileoverview Tests for Go module proxy existence checks.
 */
import nock from 'nock'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createMockCache } from './utils/test-helpers.mjs'
import { golangExists } from '../src/purl-types/golang.js'

describe('golangExists', () => {
  beforeEach(() => {
    nock.disableNetConnect()
  })

  afterEach(() => {
    nock.cleanAll()
    nock.enableNetConnect()
  })

  describe('module existence', () => {
    it('should return exists=true for existing module', async () => {
      nock('https://proxy.golang.org')
        .get('/github.com/gorilla/mux/@latest')
        .reply(200, {
          Version: 'v1.8.0',
          Time: '2022-01-01T00:00:00Z',
        })

      const result = await golangExists('github.com/gorilla/mux')

      expect(result).toEqual({
        exists: true,
        latestVersion: 'v1.8.0',
      })
    })

    it('should return exists=false for non-existent module', async () => {
      nock('https://proxy.golang.org')
        .get('/github.com/fake/module/@latest')
        .reply(404)

      const result = await golangExists('github.com/fake/module')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Module not found')
    })

    it('should handle module with namespace', async () => {
      nock('https://proxy.golang.org')
        .get('/github.com/gorilla/mux/@latest')
        .reply(200, {
          Version: 'v1.8.0',
          Time: '2022-01-01T00:00:00Z',
        })

      const result = await golangExists('mux', 'github.com/gorilla')

      expect(result).toEqual({
        exists: true,
        latestVersion: 'v1.8.0',
      })
    })

    it('should handle case-encoded module paths', async () => {
      nock('https://proxy.golang.org')
        .get('/github.com/!user/!repo/@latest')
        .reply(200, {
          Version: 'v1.0.0',
          Time: '2022-01-01T00:00:00Z',
        })

      const result = await golangExists('github.com/User/Repo')

      expect(result).toEqual({
        exists: true,
        latestVersion: 'v1.0.0',
      })
    })
  })

  describe('version validation', () => {
    it('should validate specific version exists', async () => {
      nock('https://proxy.golang.org')
        .get('/github.com/gorilla/mux/@latest')
        .reply(200, {
          Version: 'v1.8.0',
        })
        .get('/github.com/gorilla/mux/@v/v1.7.0.info')
        .reply(200, {
          Version: 'v1.7.0',
        })

      const result = await golangExists(
        'github.com/gorilla/mux',
        undefined,
        'v1.7.0',
      )

      expect(result).toEqual({
        exists: true,
        latestVersion: 'v1.8.0',
      })
    })

    it('should return error when version does not exist', async () => {
      nock('https://proxy.golang.org')
        .get('/github.com/gorilla/mux/@latest')
        .reply(200, {
          Version: 'v1.8.0',
        })
        .get('/github.com/gorilla/mux/@v/v999.0.0.info')
        .reply(404)

      const result = await golangExists(
        'github.com/gorilla/mux',
        undefined,
        'v999.0.0',
      )

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Version v999.0.0 not found')
      expect(result.latestVersion).toBe('v1.8.0')
    })
  })

  describe('error handling', () => {
    it('should handle network errors', async () => {
      nock('https://proxy.golang.org')
        .get('/github.com/test/module/@latest')
        .replyWithError('Network error')

      const result = await golangExists('github.com/test/module')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Network error')
    })

    it('should handle 410 errors as not found', async () => {
      nock('https://proxy.golang.org')
        .get('/github.com/test/module/@latest')
        .reply(410, 'Gone')

      const result = await golangExists('github.com/test/module')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Module not found')
    })
  })

  describe('caching', () => {
    it('should use cached result when available', async () => {
      const mockCache = createMockCache()

      const cachedResult = { exists: true, latestVersion: 'v1.8.0' }
      await mockCache.set('github.com/gorilla/mux', cachedResult)

      const result = await golangExists(
        'mux',
        'github.com/gorilla',
        undefined,
        { cache: mockCache },
      )

      expect(result).toEqual(cachedResult)
    })

    it('should cache result after fetching', async () => {
      const mockCache = createMockCache()

      nock('https://proxy.golang.org')
        .get('/github.com/gorilla/mux/@latest')
        .reply(200, {
          Version: 'v1.8.0',
        })

      const result = await golangExists(
        'mux',
        'github.com/gorilla',
        undefined,
        { cache: mockCache },
      )

      expect(result.exists).toBe(true)
      expect(await mockCache.get('github.com/gorilla/mux')).toEqual(result)
    })
  })
})
