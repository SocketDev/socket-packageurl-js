/*!
Copyright (c) the purl authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

/**
 * @fileoverview Tests requiring process isolation due to global mocking.
 *
 * REQUIRES ISOLATION: This file must run with pool: 'forks' or singleThread: true
 * because it mutates global objects (URL, etc.) which would interfere with
 * concurrent tests.
 *
 * Run with: vitest --config .config/vitest.config.isolated.mts [test-file-path]
 *
 * Convention: Tests that modify global state must use the .isolated.test.mts suffix
 * and will automatically be run separately with full isolation.
 */

import { describe, expect, it } from 'vitest'

import { PackageURL } from '../src/package-url.js'

describe('Global object mocking tests', () => {
  describe('URL constructor error handling', () => {
    it('should handle URL parsing error when URL constructor throws', () => {
      // Test package-url.js lines 144-148 - URL parsing failure path
      // We need to mock URL constructor to throw an error
      const originalURL = global.URL
      let callCount = 0

      // Mock URL to throw error
      global.URL = class MockURL {
        constructor(_url: string) {
          callCount++
          // Always throw to trigger the catch block
          throw new Error('Mocked URL error')
        }
      } as any

      try {
        expect(() => PackageURL.fromString('pkg:type/name')).toThrow(
          'failed to parse as URL',
        )
        // Make sure our mock was actually called
        expect(callCount).toBeGreaterThan(0)
      } finally {
        // Critical: restore original URL in finally block
        global.URL = originalURL
      }
    })
  })
})
