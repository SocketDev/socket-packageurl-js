/**
 * @fileoverview Tests for npm registry existence checks.
 */
import nock from 'nock'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { npmExists } from '../src/registry/npm.js'

describe('npmExists', () => {
  beforeEach(() => {
    nock.disableNetConnect()
  })

  afterEach(() => {
    nock.cleanAll()
    nock.enableNetConnect()
  })

  describe('package existence', () => {
    it('should return exists=true for existing package', async () => {
      nock('https://registry.npmjs.org')
        .get('/lodash')
        .reply(200, {
          'dist-tags': { latest: '4.17.21' },
          versions: { '4.17.21': {} },
        })

      const result = await npmExists('lodash')

      expect(result).toEqual({
        exists: true,
        latestVersion: '4.17.21',
      })
    })

    it('should return exists=false for non-existent package', async () => {
      nock('https://registry.npmjs.org')
        .get('/this-package-does-not-exist')
        .reply(404)

      const result = await npmExists('this-package-does-not-exist')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Package not found')
    })

    it('should handle scoped packages', async () => {
      nock('https://registry.npmjs.org')
        .get('/%40babel%2Fcore')
        .reply(200, {
          'dist-tags': { latest: '7.23.0' },
          versions: { '7.23.0': {} },
        })

      const result = await npmExists('core', '@babel')

      expect(result).toEqual({
        exists: true,
        latestVersion: '7.23.0',
      })
    })

    it('should handle package without latest tag', async () => {
      nock('https://registry.npmjs.org')
        .get('/test-package')
        .reply(200, {
          versions: { '1.0.0': {} },
        })

      const result = await npmExists('test-package')

      expect(result.exists).toBe(true)
      expect(result.latestVersion).toBeUndefined()
    })
  })

  describe('version validation', () => {
    it('should validate specific version exists', async () => {
      nock('https://registry.npmjs.org')
        .get('/lodash')
        .reply(200, {
          'dist-tags': { latest: '4.17.21' },
          versions: {
            '4.17.20': {},
            '4.17.21': {},
          },
        })

      const result = await npmExists('lodash', undefined, '4.17.20')

      expect(result).toEqual({
        exists: true,
        latestVersion: '4.17.21',
      })
    })

    it('should return error when version does not exist', async () => {
      nock('https://registry.npmjs.org')
        .get('/lodash')
        .reply(200, {
          'dist-tags': { latest: '4.17.21' },
          versions: {
            '4.17.21': {},
          },
        })

      const result = await npmExists('lodash', undefined, '999.0.0')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Version 999.0.0 not found')
      expect(result.latestVersion).toBe('4.17.21')
    })
  })

  describe('error handling', () => {
    it('should handle network errors', async () => {
      nock('https://registry.npmjs.org')
        .get('/test-package')
        .replyWithError('Network error')

      const result = await npmExists('test-package')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Network error')
    })

    it('should handle 500 errors', async () => {
      nock('https://registry.npmjs.org')
        .get('/test-package')
        .reply(500, 'Internal Server Error')

      const result = await npmExists('test-package')

      expect(result.exists).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  describe('caching', () => {
    it('should work without cache option', async () => {
      nock('https://registry.npmjs.org')
        .get('/lodash')
        .reply(200, {
          'dist-tags': { latest: '4.17.21' },
          versions: { '4.17.21': {} },
        })

      const result = await npmExists('lodash')

      expect(result.exists).toBe(true)
    })
  })
})
