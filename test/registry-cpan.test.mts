/**
 * @fileoverview Tests for CPAN registry existence checks.
 */
import nock from 'nock'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { cpanExists } from '../src/registry/cpan.js'

describe('cpanExists', () => {
  beforeEach(() => {
    nock.disableNetConnect()
  })

  afterEach(() => {
    nock.cleanAll()
    nock.enableNetConnect()
  })

  describe('module existence', () => {
    it('should return exists=true for existing module', async () => {
      nock('https://fastapi.metacpan.org').get('/v1/module/Moose').reply(200, {
        version: '2.2206',
      })

      const result = await cpanExists('Moose')

      expect(result).toEqual({
        exists: true,
        latestVersion: '2.2206',
      })
    })

    it('should return exists=false for non-existent module', async () => {
      nock('https://fastapi.metacpan.org')
        .get('/v1/module/FakeModule')
        .reply(404)

      const result = await cpanExists('FakeModule')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Module not found')
    })
  })

  describe('version validation', () => {
    it('should validate specific version exists', async () => {
      nock('https://fastapi.metacpan.org')
        .get('/v1/module/Moose')
        .reply(200, {
          version: '2.2206',
        })
        .get('/v1/module/Moose/2.2205')
        .reply(200, {
          version: '2.2205',
        })

      const result = await cpanExists('Moose', '2.2205')

      expect(result).toEqual({
        exists: true,
        latestVersion: '2.2206',
      })
    })

    it('should return error when version does not exist', async () => {
      nock('https://fastapi.metacpan.org')
        .get('/v1/module/Moose')
        .reply(200, {
          version: '2.2206',
        })
        .get('/v1/module/Moose/999.0')
        .reply(404)

      const result = await cpanExists('Moose', '999.0')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Version 999.0 not found')
      expect(result.latestVersion).toBe('2.2206')
    })
  })

  describe('error handling', () => {
    it('should handle network errors', async () => {
      nock('https://fastapi.metacpan.org')
        .get('/v1/module/TestModule')
        .replyWithError('Network error')

      const result = await cpanExists('TestModule')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Network error')
    })

    it('should handle 500 errors', async () => {
      nock('https://fastapi.metacpan.org')
        .get('/v1/module/TestModule')
        .reply(500, 'Internal Server Error')

      const result = await cpanExists('TestModule')

      expect(result.exists).toBe(false)
      expect(result.error).toBeDefined()
    })
  })
})
