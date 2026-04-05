/**
 * @fileoverview Tests for Maven Central registry existence checks.
 */
import nock from 'nock'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createMockCache } from './utils/test-helpers.mjs'
import { mavenExists } from '../src/purl-types/maven.js'

describe('mavenExists', () => {
  beforeEach(() => {
    nock.disableNetConnect()
  })

  afterEach(() => {
    nock.cleanAll()
    nock.enableNetConnect()
  })

  describe('package existence', () => {
    it('should return exists=true for existing package', async () => {
      nock('https://search.maven.org')
        .get(
          '/solrsearch/select?q=g:org.apache.commons+AND+a:commons-lang3&rows=1&wt=json',
        )
        .reply(200, {
          response: {
            numFound: 1,
            docs: [{ latestVersion: '3.12.0' }],
          },
        })

      const result = await mavenExists('commons-lang3', 'org.apache.commons')

      expect(result).toEqual({
        exists: true,
        latestVersion: '3.12.0',
      })
    })

    it('should return exists=false for non-existent package', async () => {
      nock('https://search.maven.org')
        .get(
          '/solrsearch/select?q=g:com.example+AND+a:fake-artifact&rows=1&wt=json',
        )
        .reply(200, {
          response: {
            numFound: 0,
            docs: [],
          },
        })

      const result = await mavenExists('fake-artifact', 'com.example')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Package not found')
    })

    it('should return error when namespace is missing', async () => {
      const result = await mavenExists('commons-lang3')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Maven requires namespace')
    })

    it('should use v field as fallback for latestVersion', async () => {
      nock('https://search.maven.org')
        .get('/solrsearch/select?q=g:com.test+AND+a:test&rows=1&wt=json')
        .reply(200, {
          response: {
            numFound: 1,
            docs: [{ v: '1.0.0' }],
          },
        })

      const result = await mavenExists('test', 'com.test')

      expect(result).toEqual({
        exists: true,
        latestVersion: '1.0.0',
      })
    })
  })

  describe('version validation', () => {
    it('should validate specific version exists', async () => {
      nock('https://search.maven.org')
        .get(
          '/solrsearch/select?q=g:org.apache.commons+AND+a:commons-lang3&rows=1&wt=json',
        )
        .reply(200, {
          response: {
            numFound: 1,
            docs: [{ latestVersion: '3.12.0' }],
          },
        })
        .get(
          '/solrsearch/select?q=g:org.apache.commons+AND+a:commons-lang3+AND+v:3.11.0&rows=1&wt=json',
        )
        .reply(200, {
          response: {
            numFound: 1,
          },
        })

      const result = await mavenExists(
        'commons-lang3',
        'org.apache.commons',
        '3.11.0',
      )

      expect(result).toEqual({
        exists: true,
        latestVersion: '3.12.0',
      })
    })

    it('should return error when version does not exist', async () => {
      nock('https://search.maven.org')
        .get(
          '/solrsearch/select?q=g:org.apache.commons+AND+a:commons-lang3&rows=1&wt=json',
        )
        .reply(200, {
          response: {
            numFound: 1,
            docs: [{ latestVersion: '3.12.0' }],
          },
        })
        .get(
          '/solrsearch/select?q=g:org.apache.commons+AND+a:commons-lang3+AND+v:999.0.0&rows=1&wt=json',
        )
        .reply(200, {
          response: {
            numFound: 0,
          },
        })

      const result = await mavenExists(
        'commons-lang3',
        'org.apache.commons',
        '999.0.0',
      )

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Version 999.0.0 not found')
      expect(result.latestVersion).toBe('3.12.0')
    })

    it('should return version not found without latestVersion when docs have no version fields', async () => {
      nock('https://search.maven.org')
        .get('/solrsearch/select?q=g:com.test+AND+a:test&rows=1&wt=json')
        .reply(200, {
          response: {
            numFound: 1,
            docs: [{}],
          },
        })
        .get(
          '/solrsearch/select?q=g:com.test+AND+a:test+AND+v:999.0.0&rows=1&wt=json',
        )
        .reply(200, {
          response: {
            numFound: 0,
          },
        })

      const result = await mavenExists('test', 'com.test', '999.0.0')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Version 999.0.0 not found')
      expect(result.latestVersion).toBeUndefined()
    })

    it('should return exists=true without latestVersion when docs have no version fields', async () => {
      nock('https://search.maven.org')
        .get('/solrsearch/select?q=g:com.test+AND+a:test&rows=1&wt=json')
        .reply(200, {
          response: {
            numFound: 1,
            docs: [{}],
          },
        })

      const result = await mavenExists('test', 'com.test')

      expect(result.exists).toBe(true)
      expect(result.latestVersion).toBeUndefined()
    })
  })

  describe('error handling', () => {
    it('should handle network errors', async () => {
      nock('https://search.maven.org')
        .get('/solrsearch/select?q=g:com.test+AND+a:test&rows=1&wt=json')
        .replyWithError('Network error')

      const result = await mavenExists('test', 'com.test')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('request failed')
    })

    it('should handle 500 errors', async () => {
      nock('https://search.maven.org')
        .get('/solrsearch/select?q=g:com.test+AND+a:test&rows=1&wt=json')
        .reply(500, 'Internal Server Error')

      const result = await mavenExists('test', 'com.test')

      expect(result.exists).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  describe('caching', () => {
    it('should use cached result when available', async () => {
      const mockCache = createMockCache()

      const cachedResult = { exists: true, latestVersion: '3.12.0' }
      await mockCache.set('org.apache.commons:commons-lang3', cachedResult)

      const result = await mavenExists(
        'commons-lang3',
        'org.apache.commons',
        undefined,
        { cache: mockCache },
      )

      expect(result).toEqual(cachedResult)
    })

    it('should cache result after fetching', async () => {
      const mockCache = createMockCache()

      nock('https://search.maven.org')
        .get(
          '/solrsearch/select?q=g:org.apache.commons+AND+a:commons-lang3&rows=1&wt=json',
        )
        .reply(200, {
          response: {
            numFound: 1,
            docs: [{ latestVersion: '3.12.0' }],
          },
        })

      const result = await mavenExists(
        'commons-lang3',
        'org.apache.commons',
        undefined,
        { cache: mockCache },
      )

      expect(result.exists).toBe(true)
      expect(await mockCache.get('org.apache.commons:commons-lang3')).toEqual(
        result,
      )
    })
  })
})
