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
 * @fileoverview Unit tests for type-specific PackageURL behavior.
 * Tests package-type-specific normalizations and validations for npm (legacy names, builtins),
 * pub (dash-to-underscore), and pypi (lowercase, underscore-to-dash) package types.
 */
import { describe, expect, it } from 'vitest'

import npmBuiltinNames from '../data/npm/builtin-names.json'
import npmLegacyNames from '../data/npm/legacy-names.json'
import { PackageURL } from '../src/package-url.js'

function getNpmId(purl: any) {
  const { name, namespace } = purl
  return `${namespace?.length > 0 ? `${namespace}/` : ''}${name}`
}

describe('PackageURL type-specific tests', () => {
  describe('npm', () => {
    it("should allow legacy names to be mixed case, match a builtin, or contain ~'!()* characters", () => {
      // Tests npm legacy package exceptions (historical packages with special names)
      for (const legacyName of npmLegacyNames) {
        let purl: PackageURL | undefined
        expect(() => {
          const parts = legacyName.split('/')
          const namespace = parts.length > 1 ? parts[0] : ''
          const name = parts.at(-1)
          purl = new PackageURL(
            'npm',
            namespace,
            name,
            undefined,
            undefined,
            undefined,
          )
        }).not.toThrow()
        const id = purl ? getNpmId(purl) : ''
        const isBuiltin = npmBuiltinNames.includes(id)
        const isMixedCased = /[A-Z]/.test(id)
        const containsIllegalCharacters = /[~'!()*]/.test(id)
        expect(
          isBuiltin || isMixedCased || containsIllegalCharacters,
          `assert for ${legacyName}`,
        )
      }
    })

    it('should not allow non-legacy builtin names', () => {
      // Tests npm builtin module validation (only legacy builtins allowed)
      for (const builtinName of npmBuiltinNames) {
        if (!npmLegacyNames.includes(builtinName)) {
          expect(() => {
            const parts = builtinName.split('/')
            const namespace = parts.length > 1 ? parts[0] : ''
            const name = parts.at(-1)

            new PackageURL(
              'npm',
              namespace,
              name,
              undefined,
              undefined,
              undefined,
            )
          }, `assert for ${builtinName}`).toThrow()
        }
      }
    })
  })

  describe('pub', () => {
    it('should normalize dashes to underscores', () => {
      // Tests pub-specific normalization (dashes to underscores per spec)
      const purlWithDashes = new PackageURL(
        'pub',
        '',
        'flutter-downloader',
        '1.0.0',
        undefined,
        undefined,
      )
      expect(purlWithDashes.toString()).toBe('pkg:pub/flutter_downloader@1.0.0')
    })
  })

  describe('pypi', () => {
    it('should handle pypi package-urls per the purl-spec', () => {
      // Tests PyPI-specific normalizations (lowercase, underscores to dashes)
      const purlMixedCasing = PackageURL.fromString('pkg:pypi/PYYaml@5.3.0')
      expect(purlMixedCasing.toString()).toBe('pkg:pypi/pyyaml@5.3.0')
      const purlWithUnderscore = PackageURL.fromString(
        'pkg:pypi/typing_extensions_blah@1.0.0',
      )
      expect(purlWithUnderscore.toString()).toBe(
        'pkg:pypi/typing-extensions-blah@1.0.0',
      )
    })
  })
})
