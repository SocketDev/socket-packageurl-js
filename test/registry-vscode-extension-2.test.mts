/**
 * @file Continued VS Marketplace registry tests: error handling and caching.
 */
import nock from 'nock'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createMockCache } from './utils/test-helpers.mjs'
import { vscodeExtensionExists } from '../src/purl-types/vscode-extension.mjs'

describe('vscodeExtensionExists (continued)', () => {
  beforeEach(() => {
    nock.disableNetConnect()
  })

  afterEach(() => {
    nock.cleanAll()
    nock.enableNetConnect()
  })

  describe('error handling', () => {
    it('should handle network errors', async () => {
      nock('https://marketplace.visualstudio.com')
        .post('/_apis/public/gallery/extensionquery', body => {
          return (
            body.filters &&
            body.filters[0]?.criteria[0]?.value === 'publisher.test-extension'
          )
        })
        .replyWithError('Network error')

      const result = await vscodeExtensionExists('test-extension', 'publisher')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('request failed')
    })

    it('should handle 500 errors', async () => {
      nock('https://marketplace.visualstudio.com')
        .post('/_apis/public/gallery/extensionquery', body => {
          return (
            body.filters &&
            body.filters[0]?.criteria[0]?.value === 'publisher.test-extension'
          )
        })
        .reply(500, 'Internal Server Error')

      const result = await vscodeExtensionExists('test-extension', 'publisher')

      expect(result.exists).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('should handle 404 errors', async () => {
      nock('https://marketplace.visualstudio.com')
        .post('/_apis/public/gallery/extensionquery', body => {
          return (
            body.filters &&
            body.filters[0]?.criteria[0]?.value === 'publisher.test-extension'
          )
        })
        .reply(404)

      const result = await vscodeExtensionExists('test-extension', 'publisher')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Extension not found')
    })
  })

  describe('caching', () => {
    it('should work without cache option', async () => {
      nock('https://marketplace.visualstudio.com')
        .post('/_apis/public/gallery/extensionquery', body => {
          return (
            body.filters &&
            body.filters[0]?.criteria[0]?.value === 'dbaeumer.vscode-eslint'
          )
        })
        .reply(200, {
          results: [
            {
              extensions: [
                {
                  versions: [{ version: '2.4.2' }],
                },
              ],
            },
          ],
        })

      const result = await vscodeExtensionExists('vscode-eslint', 'dbaeumer')

      expect(result.exists).toBe(true)
    })

    it('should use cached result when available', async () => {
      const mockCache = createMockCache()

      // Pre-populate cache
      const cachedResult = { exists: true, latestVersion: '2.4.2' }
      await mockCache.set(
        'vscode-extension:dbaeumer.vscode-eslint',
        cachedResult,
      )

      // Should not make HTTP request
      const result = await vscodeExtensionExists(
        'vscode-eslint',
        'dbaeumer',
        undefined,
        {
          cache: mockCache,
        },
      )

      expect(result).toEqual(cachedResult)
    })

    it('should cache the result after fetching', async () => {
      const mockCache = createMockCache()

      nock('https://marketplace.visualstudio.com')
        .post('/_apis/public/gallery/extensionquery', body => {
          return (
            body.filters &&
            body.filters[0]?.criteria[0]?.value === 'publisher.test-extension'
          )
        })
        .reply(200, {
          results: [
            {
              extensions: [
                {
                  versions: [{ version: '1.0.0' }],
                },
              ],
            },
          ],
        })

      const result = await vscodeExtensionExists(
        'test-extension',
        'publisher',
        undefined,
        {
          cache: mockCache,
        },
      )

      expect(result.exists).toBe(true)

      // Verify cached
      expect(
        await mockCache.get('vscode-extension:publisher.test-extension'),
      ).toBeDefined()
    })

    it('should include version in cache key', async () => {
      const mockCache = createMockCache()

      nock('https://marketplace.visualstudio.com')
        .post('/_apis/public/gallery/extensionquery', body => {
          return (
            body.filters &&
            body.filters[0]?.criteria[0]?.value === 'dbaeumer.vscode-eslint'
          )
        })
        .reply(200, {
          results: [
            {
              extensions: [
                {
                  versions: [{ version: '2.4.2' }, { version: '2.4.1' }],
                },
              ],
            },
          ],
        })

      await vscodeExtensionExists('vscode-eslint', 'dbaeumer', '2.4.1', {
        cache: mockCache,
      })

      expect(
        await mockCache.get('vscode-extension:dbaeumer.vscode-eslint@2.4.1'),
      ).toBeDefined()
    })

    it('should not cache error results (prevents negative cache poisoning)', async () => {
      const mockCache = createMockCache()

      nock('https://marketplace.visualstudio.com')
        .post('/_apis/public/gallery/extensionquery', body => {
          return (
            body.filters &&
            body.filters[0]?.criteria[0]?.value === 'publisher.non-existent'
          )
        })
        .reply(200, {
          results: [
            {
              extensions: [],
            },
          ],
        })

      const result = await vscodeExtensionExists(
        'non-existent',
        'publisher',
        undefined,
        {
          cache: mockCache,
        },
      )

      expect(result.exists).toBe(false)
      expect(
        await mockCache.get('vscode-extension:publisher.non-existent'),
      ).toBeUndefined()
    })
  })
})
