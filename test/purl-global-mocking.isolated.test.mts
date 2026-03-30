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
  describe('Primordials protect against global tampering', () => {
    it('should use captured URL constructor even when global.URL is replaced', () => {
      // Primordials capture built-in references at module load time.
      // Replacing global.URL after import should NOT affect PackageURL.
      const originalURL = global.URL

      global.URL = class MockURL {
        constructor(_url: string) {
          throw new Error('Mocked URL error - should not be called')
        }
      } as any

      try {
        // PackageURL uses the captured URL constructor from primordials,
        // so it should still work correctly despite global.URL being tampered.
        const purl = PackageURL.fromString('pkg:npm/lodash@4.17.21')
        expect(purl.type).toBe('npm')
        expect(purl.name).toBe('lodash')
        expect(purl.version).toBe('4.17.21')
      } finally {
        global.URL = originalURL
      }
    })
  })
})
