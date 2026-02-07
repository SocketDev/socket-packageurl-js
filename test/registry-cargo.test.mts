/**
 * @fileoverview Tests for Cargo (crates.io) registry existence checks.
 */
import nock from 'nock'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { cargoExists } from '../src/registry/cargo.js'

describe('cargoExists', () => {
  beforeEach(() => {
    nock.disableNetConnect()
  })

  afterEach(() => {
    nock.cleanAll()
    nock.enableNetConnect()
  })

  describe('crate existence', () => {
    it('should return exists=true for existing crate', async () => {
      nock('https://crates.io')
        .get('/api/v1/crates/serde')
        .reply(200, {
          crate: { max_version: '1.0.197' },
          versions: [{ num: '1.0.197' }],
        })

      const result = await cargoExists('serde')

      expect(result).toEqual({
        exists: true,
        latestVersion: '1.0.197',
      })
    })

    it('should return exists=false for non-existent crate', async () => {
      nock('https://crates.io')
        .get('/api/v1/crates/this-crate-does-not-exist')
        .reply(404)

      const result = await cargoExists('this-crate-does-not-exist')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Crate not found')
    })

    it('should fallback to versions array for latest version', async () => {
      nock('https://crates.io')
        .get('/api/v1/crates/tokio')
        .reply(200, {
          versions: [{ num: '1.36.0' }, { num: '1.35.0' }],
        })

      const result = await cargoExists('tokio')

      expect(result).toEqual({
        exists: true,
        latestVersion: '1.36.0',
      })
    })

    it('should handle crate without version info', async () => {
      nock('https://crates.io').get('/api/v1/crates/test-crate').reply(200, {})

      const result = await cargoExists('test-crate')

      expect(result.exists).toBe(true)
      expect(result.latestVersion).toBeUndefined()
    })
  })

  describe('version validation', () => {
    it('should validate specific version exists', async () => {
      nock('https://crates.io')
        .get('/api/v1/crates/serde')
        .reply(200, {
          crate: { max_version: '1.0.197' },
          versions: [{ num: '1.0.196' }, { num: '1.0.197' }],
        })

      const result = await cargoExists('serde', '1.0.196')

      expect(result).toEqual({
        exists: true,
        latestVersion: '1.0.197',
      })
    })

    it('should return error when version does not exist', async () => {
      nock('https://crates.io')
        .get('/api/v1/crates/serde')
        .reply(200, {
          crate: { max_version: '1.0.197' },
          versions: [{ num: '1.0.197' }],
        })

      const result = await cargoExists('serde', '999.0.0')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Version 999.0.0 not found')
      expect(result.latestVersion).toBe('1.0.197')
    })

    it('should handle version check when versions array is missing', async () => {
      nock('https://crates.io')
        .get('/api/v1/crates/serde')
        .reply(200, {
          crate: { max_version: '1.0.197' },
        })

      const result = await cargoExists('serde', '1.0.196')

      expect(result.exists).toBe(true)
      expect(result.latestVersion).toBe('1.0.197')
    })

    it('should handle version not found with missing version info', async () => {
      nock('https://crates.io')
        .get('/api/v1/crates/serde')
        .reply(200, {
          versions: [{}],
        })

      const result = await cargoExists('serde', '999.0.0')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Version 999.0.0 not found')
      expect(result.latestVersion).toBeUndefined()
    })
  })

  describe('error handling', () => {
    it('should handle network errors', async () => {
      nock('https://crates.io')
        .get('/api/v1/crates/test-crate')
        .replyWithError('Network error')

      const result = await cargoExists('test-crate')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Network error')
    })

    it('should handle 500 errors', async () => {
      nock('https://crates.io')
        .get('/api/v1/crates/test-crate')
        .reply(500, 'Internal Server Error')

      const result = await cargoExists('test-crate')

      expect(result.exists).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  describe('caching', () => {
    it('should use cached result when available', async () => {
      const cacheData = new Map<string, unknown>()
      const mockCache = {
        get: async <T,>(key: string): Promise<T | undefined> => {
          return cacheData.get(key) as T | undefined
        },
        set: async <T,>(key: string, value: T): Promise<void> => {
          cacheData.set(key, value)
        },
      }

      const cachedResult = { exists: true, latestVersion: '1.0.197' }
      await mockCache.set('serde', cachedResult)

      const result = await cargoExists('serde', undefined, { cache: mockCache })

      expect(result).toEqual(cachedResult)
    })

    it('should cache result after fetching', async () => {
      const cacheData = new Map<string, unknown>()
      const mockCache = {
        get: async <T,>(key: string): Promise<T | undefined> => {
          return cacheData.get(key) as T | undefined
        },
        set: async <T,>(key: string, value: T): Promise<void> => {
          cacheData.set(key, value)
        },
      }

      nock('https://crates.io')
        .get('/api/v1/crates/serde')
        .reply(200, {
          crate: { max_version: '1.0.197' },
          versions: [{ num: '1.0.197' }],
        })

      const result = await cargoExists('serde', undefined, { cache: mockCache })

      expect(result.exists).toBe(true)
      expect(cacheData.get('serde')).toEqual(result)
    })
  })
})
