/**
 * @fileoverview Tests for Docker Hub registry existence checks.
 */
import nock from 'nock'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createMockCache } from './utils/test-helpers.mjs'
import { dockerExists } from '../src/purl-types/docker.js'

describe('dockerExists', () => {
  beforeEach(() => {
    nock.disableNetConnect()
  })

  afterEach(() => {
    nock.cleanAll()
    nock.enableNetConnect()
  })

  describe('image existence', () => {
    it('should return exists=true for existing image with namespace', async () => {
      nock('https://hub.docker.com')
        .get('/v2/repositories/library/nginx')
        .reply(200, {
          name: 'nginx',
          namespace: 'library',
        })

      const result = await dockerExists('nginx', 'library')

      expect(result).toEqual({
        exists: true,
        latestVersion: 'latest',
      })
    })

    it('should return exists=true for existing image without namespace', async () => {
      nock('https://hub.docker.com')
        .get('/v2/repositories/myimage')
        .reply(200, {
          name: 'myimage',
        })

      const result = await dockerExists('myimage')

      expect(result).toEqual({
        exists: true,
        latestVersion: 'latest',
      })
    })

    it('should return exists=false for non-existent image', async () => {
      nock('https://hub.docker.com')
        .get('/v2/repositories/library/this-image-does-not-exist')
        .reply(404)

      const result = await dockerExists('this-image-does-not-exist', 'library')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Image not found')
    })

    it('should handle image without name property', async () => {
      nock('https://hub.docker.com')
        .get('/v2/repositories/library/test-image')
        .reply(200, {
          // No name property
        })

      const result = await dockerExists('test-image', 'library')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Image not found')
    })
  })

  describe('tag validation', () => {
    it('should validate specific tag exists', async () => {
      nock('https://hub.docker.com')
        .get('/v2/repositories/library/nginx')
        .reply(200, {
          name: 'nginx',
        })
        .get('/v2/repositories/library/nginx/tags/1.25.3')
        .reply(200, {
          name: '1.25.3',
        })

      const result = await dockerExists('nginx', 'library', '1.25.3')

      expect(result).toEqual({
        exists: true,
        latestVersion: '1.25.3',
      })
    })

    it('should return error when tag does not exist', async () => {
      nock('https://hub.docker.com')
        .get('/v2/repositories/library/nginx')
        .reply(200, {
          name: 'nginx',
        })
        .get('/v2/repositories/library/nginx/tags/999.0.0')
        .reply(404)

      const result = await dockerExists('nginx', 'library', '999.0.0')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Tag 999.0.0 not found')
    })

    it('should validate tag for image without namespace', async () => {
      nock('https://hub.docker.com')
        .get('/v2/repositories/myuser/myimage')
        .reply(200, {
          name: 'myimage',
        })
        .get('/v2/repositories/myuser/myimage/tags/v1.0.0')
        .reply(200, {
          name: 'v1.0.0',
        })

      const result = await dockerExists('myimage', 'myuser', 'v1.0.0')

      expect(result.exists).toBe(true)
      expect(result.latestVersion).toBe('v1.0.0')
    })
  })

  describe('error handling', () => {
    it('should handle network errors', async () => {
      nock('https://hub.docker.com')
        .get('/v2/repositories/library/test-image')
        .replyWithError('Network error')

      const result = await dockerExists('test-image', 'library')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('request failed')
    })

    it('should handle 500 errors', async () => {
      nock('https://hub.docker.com')
        .get('/v2/repositories/library/test-image')
        .reply(500, 'Internal Server Error')

      const result = await dockerExists('test-image', 'library')

      expect(result.exists).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('should handle tag validation network errors', async () => {
      nock('https://hub.docker.com')
        .get('/v2/repositories/library/nginx')
        .reply(200, {
          name: 'nginx',
        })
        .get('/v2/repositories/library/nginx/tags/test')
        .replyWithError('Network error')

      const result = await dockerExists('nginx', 'library', 'test')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('request failed')
    })
  })

  describe('caching', () => {
    it('should work without cache option', async () => {
      nock('https://hub.docker.com')
        .get('/v2/repositories/library/nginx')
        .reply(200, {
          name: 'nginx',
        })

      const result = await dockerExists('nginx', 'library')

      expect(result.exists).toBe(true)
    })

    it('should use cached result when available', async () => {
      const mockCache = createMockCache()

      // Pre-populate cache
      const cachedResult = { exists: true, latestVersion: 'latest' }
      await mockCache.set('docker:library/nginx', cachedResult)

      // Should not make HTTP request
      const result = await dockerExists('nginx', 'library', undefined, {
        cache: mockCache,
      })

      expect(result).toEqual(cachedResult)
    })

    it('should cache the result after fetching', async () => {
      const mockCache = createMockCache()

      nock('https://hub.docker.com')
        .get('/v2/repositories/library/redis')
        .reply(200, {
          name: 'redis',
        })

      const result = await dockerExists('redis', 'library', undefined, {
        cache: mockCache,
      })

      expect(result.exists).toBe(true)

      // Verify cached
      expect(await mockCache.get('docker:library/redis')).toBeDefined()
    })

    it('should include tag in cache key', async () => {
      const mockCache = createMockCache()

      nock('https://hub.docker.com')
        .get('/v2/repositories/library/nginx')
        .reply(200, {
          name: 'nginx',
        })
        .get('/v2/repositories/library/nginx/tags/1.25.3')
        .reply(200, {
          name: '1.25.3',
        })

      await dockerExists('nginx', 'library', '1.25.3', { cache: mockCache })

      expect(await mockCache.get('docker:library/nginx:1.25.3')).toBeDefined()
    })

    it('should use correct cache key without namespace', async () => {
      const mockCache = createMockCache()

      nock('https://hub.docker.com')
        .get('/v2/repositories/myimage')
        .reply(200, {
          name: 'myimage',
        })

      await dockerExists('myimage', undefined, undefined, { cache: mockCache })

      expect(await mockCache.get('docker:myimage')).toBeDefined()
    })
  })
})
