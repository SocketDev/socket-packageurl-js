/**
 * @fileoverview Tests for Hex registry existence checks.
 */
import nock from 'nock'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { hexExists } from '../src/registry/hex.js'

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
  })

  describe('error handling', () => {
    it('should handle network errors', async () => {
      nock('https://hex.pm')
        .get('/api/packages/test_package')
        .replyWithError('Network error')

      const result = await hexExists('test_package')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Network error')
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
})
