/**
 * @fileoverview Tests for RubyGems registry existence checks.
 */
import nock from 'nock'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { gemExists } from '../src/registry/gem.js'

describe('gemExists', () => {
  beforeEach(() => {
    nock.disableNetConnect()
  })

  afterEach(() => {
    nock.cleanAll()
    nock.enableNetConnect()
  })

  describe('gem existence', () => {
    it('should return exists=true for existing gem', async () => {
      nock('https://rubygems.org')
        .get('/api/v1/versions/rails.json')
        .reply(200, [{ number: '7.1.3' }, { number: '7.1.2' }])

      const result = await gemExists('rails')

      expect(result).toEqual({
        exists: true,
        latestVersion: '7.1.3',
      })
    })

    it('should return exists=false for non-existent gem', async () => {
      nock('https://rubygems.org')
        .get('/api/v1/versions/this-gem-does-not-exist.json')
        .reply(404)

      const result = await gemExists('this-gem-does-not-exist')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Gem not found')
    })

    it('should return error for empty versions array', async () => {
      nock('https://rubygems.org')
        .get('/api/v1/versions/test-gem.json')
        .reply(200, [])

      const result = await gemExists('test-gem')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('No versions found')
    })

    it('should handle gem with single version', async () => {
      nock('https://rubygems.org')
        .get('/api/v1/versions/new-gem.json')
        .reply(200, [{ number: '0.1.0' }])

      const result = await gemExists('new-gem')

      expect(result).toEqual({
        exists: true,
        latestVersion: '0.1.0',
      })
    })
  })

  describe('version validation', () => {
    it('should validate specific version exists', async () => {
      nock('https://rubygems.org')
        .get('/api/v1/versions/rake.json')
        .reply(200, [
          { number: '13.1.0' },
          { number: '13.0.0' },
          { number: '12.3.0' },
        ])

      const result = await gemExists('rake', '13.0.0')

      expect(result).toEqual({
        exists: true,
        latestVersion: '13.1.0',
      })
    })

    it('should return error when version does not exist', async () => {
      nock('https://rubygems.org')
        .get('/api/v1/versions/rake.json')
        .reply(200, [{ number: '13.1.0' }])

      const result = await gemExists('rake', '999.0.0')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Version 999.0.0 not found')
      expect(result.latestVersion).toBe('13.1.0')
    })
  })

  describe('error handling', () => {
    it('should handle network errors', async () => {
      nock('https://rubygems.org')
        .get('/api/v1/versions/test-gem.json')
        .replyWithError('Network error')

      const result = await gemExists('test-gem')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Network error')
    })

    it('should handle 500 errors', async () => {
      nock('https://rubygems.org')
        .get('/api/v1/versions/test-gem.json')
        .reply(500, 'Internal Server Error')

      const result = await gemExists('test-gem')

      expect(result.exists).toBe(false)
      expect(result.error).toBeDefined()
    })
  })
})
