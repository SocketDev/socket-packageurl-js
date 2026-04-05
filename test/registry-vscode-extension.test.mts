/**
 * @fileoverview Tests for VS Marketplace registry existence checks.
 * Based on actual VS Marketplace API format: https://gist.github.com/scottmwyant/70f5fd296a935a15c8fbb9b9d646e6ca
 */
import nock from 'nock'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createMockCache } from './utils/test-helpers.mjs'
import { vscodeExtensionExists } from '../src/purl-types/vscode-extension.js'

describe('vscodeExtensionExists', () => {
  beforeEach(() => {
    nock.disableNetConnect()
  })

  afterEach(() => {
    nock.cleanAll()
    nock.enableNetConnect()
  })

  describe('extension existence', () => {
    it('should return exists=true for existing extension', async () => {
      nock('https://marketplace.visualstudio.com')
        .post('/_apis/public/gallery/extensionquery', body => {
          // Match the request body structure sent by vscodeExtensionExists
          return (
            body.filters &&
            body.filters[0]?.criteria[0]?.filterType === 7 &&
            body.filters[0]?.criteria[0]?.value === 'dbaeumer.vscode-eslint' &&
            body.flags === 914
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

      const result = await vscodeExtensionExists('vscode-eslint', 'dbaeumer')

      expect(result).toEqual({
        exists: true,
        latestVersion: '2.4.2',
      })
    })

    it('should return error when namespace is missing', async () => {
      const result = await vscodeExtensionExists('vscode-eslint')

      expect(result.exists).toBe(false)
      expect(result.error).toContain(
        'Namespace (publisher) is required for VSCode extensions',
      )
    })

    it('should send POST request with correct headers', async () => {
      // Verify that httpJson sends the correct Content-Type and Accept headers
      nock('https://marketplace.visualstudio.com')
        .post('/_apis/public/gallery/extensionquery')
        .matchHeader('content-type', 'application/json')
        .matchHeader('accept', 'application/json;api-version=7.1-preview.1')
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
      expect(result.latestVersion).toBe('2.4.2')
    })

    it('should return exists=false for non-existent extension', async () => {
      nock('https://marketplace.visualstudio.com')
        .post('/_apis/public/gallery/extensionquery', body => {
          return (
            body.filters &&
            body.filters[0]?.criteria[0]?.filterType === 7 &&
            body.filters[0]?.criteria[0]?.value ===
              'publisher.non-existent-extension'
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
        'non-existent-extension',
        'publisher',
      )

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Extension not found')
    })

    it('should handle extension without versions', async () => {
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
                  // No versions array
                },
              ],
            },
          ],
        })

      const result = await vscodeExtensionExists('test-extension', 'publisher')

      expect(result.exists).toBe(true)
      expect(result.latestVersion).toBeUndefined()
    })

    it('should handle response without results', async () => {
      nock('https://marketplace.visualstudio.com')
        .post('/_apis/public/gallery/extensionquery', body => {
          return (
            body.filters &&
            body.filters[0]?.criteria[0]?.value === 'publisher.test-extension'
          )
        })
        .reply(200, {
          // No results array
        })

      const result = await vscodeExtensionExists('test-extension', 'publisher')

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Extension not found')
    })
  })

  describe('version validation', () => {
    it('should validate specific version exists', async () => {
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
                  versions: [
                    { version: '2.4.2' },
                    { version: '2.4.1' },
                    { version: '2.4.0' },
                  ],
                },
              ],
            },
          ],
        })

      const result = await vscodeExtensionExists(
        'vscode-eslint',
        'dbaeumer',
        '2.4.1',
      )

      expect(result).toEqual({
        exists: true,
        latestVersion: '2.4.2',
      })
    })

    it('should return error when version does not exist', async () => {
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

      const result = await vscodeExtensionExists(
        'vscode-eslint',
        'dbaeumer',
        '999.0.0',
      )

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Version 999.0.0 not found')
      expect(result.latestVersion).toBe('2.4.2')
    })

    it('should return version not found without latestVersion when version field is missing', async () => {
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
                  versions: [{}],
                },
              ],
            },
          ],
        })

      const result = await vscodeExtensionExists(
        'vscode-eslint',
        'dbaeumer',
        '999.0.0',
      )

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Version 999.0.0 not found')
      expect(result.latestVersion).toBeUndefined()
    })

    it('should return exists=true without latestVersion when version field is missing in versions', async () => {
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
                  versions: [{}],
                },
              ],
            },
          ],
        })

      const result = await vscodeExtensionExists('test-extension', 'publisher')

      expect(result.exists).toBe(true)
      expect(result.latestVersion).toBeUndefined()
    })

    it('should handle version check without versions array', async () => {
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
                  // No versions array
                },
              ],
            },
          ],
        })

      const result = await vscodeExtensionExists(
        'vscode-eslint',
        'dbaeumer',
        '2.4.0',
      )

      expect(result.exists).toBe(true)
      expect(result.latestVersion).toBeUndefined()
    })
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
      await mockCache.set('dbaeumer.vscode-eslint', cachedResult)

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
      expect(await mockCache.get('publisher.test-extension')).toBeDefined()
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

      expect(await mockCache.get('dbaeumer.vscode-eslint@2.4.1')).toBeDefined()
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
      expect(await mockCache.get('publisher.non-existent')).toBeUndefined()
    })
  })
})
