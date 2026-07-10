/**
 * @file Tests for Go module proxy existence checks.
 */
import nock from 'nock'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createMockCache } from './utils/test-helpers.mjs'
import {
  decodeGolangProxyPath,
  encodeGolangProxyPath,
  golangExists,
} from '../src/purl-types/golang.mjs'

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

    it('should return version not found without latestVersion when Version field is missing', async () => {
      nock('https://proxy.golang.org')
        .get('/github.com/gorilla/mux/@latest')
        .reply(200, {
          Time: '2022-01-01T00:00:00Z',
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
      expect(result.latestVersion).toBeUndefined()
    })

    it('should return exists=true without latestVersion when Version field is missing', async () => {
      nock('https://proxy.golang.org')
        .get('/github.com/gorilla/mux/@latest')
        .reply(200, {
          Time: '2022-01-01T00:00:00Z',
        })

      const result = await golangExists('github.com/gorilla/mux')

      expect(result.exists).toBe(true)
      expect(result.latestVersion).toBeUndefined()
    })
  })

  describe('error handling', () => {
    it('should handle network errors', async () => {
      nock('https://proxy.golang.org')
        .get('/github.com/test/module/@latest')
        .replyWithError('Network error')

      const result = await golangExists('github.com/test/module')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('request failed')
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
      await mockCache.set('golang:github.com/gorilla/mux', cachedResult)

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
      expect(await mockCache.get('golang:github.com/gorilla/mux')).toEqual(
        result,
      )
    })
  })
})

describe('Go module proxy escape encoding', () => {
  // The proxy protocol escapes uppercase letters as `!lowercase`; the two
  // helpers are exact inverses. inclusive-language: external-api -- `DataDog`,
  // `Azure`, and `BurntSushi` are real GitHub orgs.
  // https://go.dev/ref/mod#goproxy-protocol
  describe('encodeGolangProxyPath', () => {
    it.each([
      ['github.com/DataDog/datadog-go', 'github.com/!data!dog/datadog-go'],
      ['github.com/Azure/go-autorest', 'github.com/!azure/go-autorest'],
      ['github.com/BurntSushi/toml', 'github.com/!burnt!sushi/toml'],
      ['v1.0.0-RC1', 'v1.0.0-!r!c1'],
      // No uppercase letters -> unchanged.
      ['github.com/gin-gonic/gin', 'github.com/gin-gonic/gin'],
      ['v4.8.3+incompatible', 'v4.8.3+incompatible'],
    ])('escapes %s -> %s', (input, expected) => {
      expect(encodeGolangProxyPath(input)).toBe(expected)
    })
  })

  describe('decodeGolangProxyPath', () => {
    it.each([
      ['github.com/!data!dog/datadog-go', 'github.com/DataDog/datadog-go'],
      ['github.com/!azure/go-autorest', 'github.com/Azure/go-autorest'],
      ['github.com/!burnt!sushi/toml', 'github.com/BurntSushi/toml'],
      ['v1.0.0-!r!c1', 'v1.0.0-RC1'],
      // No escape sequences -> unchanged.
      ['github.com/gin-gonic/gin', 'github.com/gin-gonic/gin'],
      ['v4.8.3+incompatible', 'v4.8.3+incompatible'],
    ])('decodes %s -> %s', (input, expected) => {
      expect(decodeGolangProxyPath(input)).toBe(expected)
    })
  })

  describe('round trip', () => {
    it.each([
      'github.com/DataDog/datadog-go',
      'github.com/Masterminds/semver/v3',
      'v1.0.0-RC1',
    ])('encode then decode is identity for %s', input => {
      expect(decodeGolangProxyPath(encodeGolangProxyPath(input))).toBe(input)
    })
  })
})
