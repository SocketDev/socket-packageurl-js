/**
 * @fileoverview Tests for NuGet registry existence checks.
 */
import nock from 'nock'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createMockCache } from './utils/test-helpers.mjs'
import { nugetExists } from '../src/purl-types/nuget.js'

describe('nugetExists', () => {
  beforeEach(() => {
    nock.disableNetConnect()
  })

  afterEach(() => {
    nock.cleanAll()
    nock.enableNetConnect()
  })

  describe('package existence', () => {
    it('should return exists=true for existing package', async () => {
      nock('https://api.nuget.org')
        .get('/v3/registration5-semver1/newtonsoft.json/index.json')
        .reply(200, {
          items: [
            {
              items: [
                { catalogEntry: { version: '13.0.1' } },
                { catalogEntry: { version: '13.0.3' } },
              ],
            },
          ],
        })

      const result = await nugetExists('Newtonsoft.Json')

      expect(result).toEqual({
        exists: true,
        latestVersion: '13.0.3',
      })
    })

    it('should return exists=false for non-existent package', async () => {
      nock('https://api.nuget.org')
        .get('/v3/registration5-semver1/fake-package-xyz/index.json')
        .reply(404)

      const result = await nugetExists('fake-package-xyz')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Package not found')
    })

    it('should return error for empty items array', async () => {
      nock('https://api.nuget.org')
        .get('/v3/registration5-semver1/test/index.json')
        .reply(200, { items: [] })

      const result = await nugetExists('test')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Package not found')
    })

    it('should return error for missing versions', async () => {
      nock('https://api.nuget.org')
        .get('/v3/registration5-semver1/test/index.json')
        .reply(200, {
          items: [{ items: [] }],
        })

      const result = await nugetExists('test')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('No versions found')
    })

    it('should skip pages without items property', async () => {
      nock('https://api.nuget.org')
        .get('/v3/registration5-semver1/test/index.json')
        .reply(200, {
          items: [
            {},
            {
              items: [{ catalogEntry: { version: '1.0.0' } }],
            },
          ],
        })

      const result = await nugetExists('test')

      expect(result.exists).toBe(true)
      expect(result.latestVersion).toBe('1.0.0')
    })
  })

  describe('version validation', () => {
    it('should validate specific version exists', async () => {
      nock('https://api.nuget.org')
        .get('/v3/registration5-semver1/newtonsoft.json/index.json')
        .reply(200, {
          items: [
            {
              items: [
                { catalogEntry: { version: '13.0.1' } },
                { catalogEntry: { version: '13.0.3' } },
              ],
            },
          ],
        })

      const result = await nugetExists('Newtonsoft.Json', '13.0.1')

      expect(result).toEqual({
        exists: true,
        latestVersion: '13.0.3',
      })
    })

    it('should return error when version does not exist', async () => {
      nock('https://api.nuget.org')
        .get('/v3/registration5-semver1/newtonsoft.json/index.json')
        .reply(200, {
          items: [
            {
              items: [{ catalogEntry: { version: '13.0.3' } }],
            },
          ],
        })

      const result = await nugetExists('Newtonsoft.Json', '999.0.0')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Version 999.0.0 not found')
      expect(result.latestVersion).toBe('13.0.3')
    })
  })

  describe('error handling', () => {
    it('should handle network errors', async () => {
      nock('https://api.nuget.org')
        .get('/v3/registration5-semver1/test/index.json')
        .replyWithError('Network error')

      const result = await nugetExists('test')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('request failed')
    })

    it('should handle 500 errors', async () => {
      nock('https://api.nuget.org')
        .get('/v3/registration5-semver1/test/index.json')
        .reply(500, 'Internal Server Error')

      const result = await nugetExists('test')

      expect(result.exists).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  describe('caching', () => {
    it('should use cached result when available', async () => {
      const mockCache = createMockCache()

      const cachedResult = { exists: true, latestVersion: '13.0.3' }
      await mockCache.set('Newtonsoft.Json', cachedResult)

      const result = await nugetExists('Newtonsoft.Json', undefined, {
        cache: mockCache,
      })

      expect(result).toEqual(cachedResult)
    })

    it('should cache result after fetching', async () => {
      const mockCache = createMockCache()

      nock('https://api.nuget.org')
        .get('/v3/registration5-semver1/newtonsoft.json/index.json')
        .reply(200, {
          items: [
            {
              items: [{ catalogEntry: { version: '13.0.3' } }],
            },
          ],
        })

      const result = await nugetExists('Newtonsoft.Json', undefined, {
        cache: mockCache,
      })

      expect(result.exists).toBe(true)
      expect(await mockCache.get('Newtonsoft.Json')).toEqual(result)
    })
  })
})
