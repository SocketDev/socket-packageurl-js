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
 * @file Global tampering regression. The main suite isolates each test file;
 *   this synchronous case restores URL before returning.
 */

import { describe, expect, it } from 'vitest'

import { PackageURL } from '../src/package-url.mjs'

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
      } as unknown as typeof URL

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
