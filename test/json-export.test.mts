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
 * @fileoverview Unit tests for JSON/dict export functionality.
 */
import { describe, expect, it } from 'vitest'

import { PackageURL } from '../dist/package-url.js'

describe('PackageURL JSON/dict export', () => {
  describe('toObject', () => {
    it('should convert PackageURL to object', () => {
      const simplePurl = new PackageURL(
        'npm',
        undefined,
        'lodash',
        undefined,
        undefined,
        undefined,
      )
      const simpleObj = simplePurl.toObject()

      expect(simpleObj).toEqual({
        type: 'npm',
        name: 'lodash',
      })

      const completePurl = new PackageURL(
        'npm',
        '@types',
        'node',
        '16.11.7',
        { arch: 'x64', os: 'linux' },
        'lib/fs.d.ts',
      )
      const completeObj = completePurl.toObject()

      expect(completeObj).toEqual({
        type: 'npm',
        namespace: '@types',
        name: 'node',
        version: '16.11.7',
        qualifiers: { arch: 'x64', os: 'linux' },
        subpath: 'lib/fs.d.ts',
      })
    })

    it('should handle empty qualifiers object', () => {
      const purl = new PackageURL(
        'npm',
        undefined,
        'lodash',
        undefined,
        {},
        undefined,
      )
      const obj = purl.toObject()

      // Empty qualifiers get normalized to undefined
      expect(obj).toEqual({
        type: 'npm',
        name: 'lodash',
      })
    })

    it('should preserve qualifiers exactly', () => {
      const qualifiers = { arch: 'x64', os: 'linux', env: 'production' }
      const purl = new PackageURL(
        'npm',
        undefined,
        'lodash',
        undefined,
        qualifiers,
        undefined,
      )
      const obj = purl.toObject()

      expect(obj['qualifiers']).toEqual(qualifiers)
      // Should be a copy, not the same reference
      expect(obj['qualifiers']).not.toBe(qualifiers)
    })
  })

  describe('toJSONString', () => {
    it('should convert PackageURL to JSON string', () => {
      const simplePurl = new PackageURL(
        'npm',
        undefined,
        'lodash',
        '4.17.21',
        undefined,
        undefined,
      )
      const simpleJson = simplePurl.toJSONString()
      expect(simpleJson).toBe(
        '{"type":"npm","name":"lodash","version":"4.17.21"}',
      )

      const completePurl = new PackageURL(
        'npm',
        '@types',
        'node',
        '16.11.7',
        { arch: 'x64' },
        'lib/fs.d.ts',
      )
      const completeJson = completePurl.toJSONString()
      const parsed = JSON.parse(completeJson)

      expect(parsed).toEqual({
        type: 'npm',
        namespace: '@types',
        name: 'node',
        version: '16.11.7',
        qualifiers: { arch: 'x64' },
        subpath: 'lib/fs.d.ts',
      })
    })

    it('should produce valid JSON', () => {
      const purl = new PackageURL(
        'npm',
        '@types',
        'node',
        '16.11.7',
        { arch: 'x64', os: 'linux' },
        'lib/fs.d.ts',
      )
      const json = purl.toJSONString()

      expect(() => JSON.parse(json)).not.toThrow()
    })

    it('should be consistent with toObject', () => {
      const purl = new PackageURL(
        'maven',
        'org.apache.commons',
        'commons-lang3',
        '3.12.0',
        { classifier: 'sources' },
        undefined,
      )
      const obj = purl.toObject()
      const jsonObj = JSON.parse(purl.toJSONString())

      expect(jsonObj).toEqual(obj)
    })
  })

  describe('toJSON', () => {
    it('should return object for JSON.stringify and be consistent with toObject', () => {
      const purl = new PackageURL(
        'npm',
        undefined,
        'lodash',
        '4.17.21',
        undefined,
        undefined,
      )
      const jsonResult = purl.toJSON()

      expect(jsonResult).toEqual({
        type: 'npm',
        name: 'lodash',
        version: '4.17.21',
      })

      const complexPurl = new PackageURL(
        'npm',
        '@types',
        'node',
        '16.11.7',
        { arch: 'x64' },
        'lib/fs.d.ts',
      )
      const complexJsonResult = complexPurl.toJSON()
      const objResult = complexPurl.toObject()

      expect(complexJsonResult).toEqual(objResult)
    })
  })

  describe('fromObject', () => {
    it('should create PackageURL from object', () => {
      const simpleObj = { type: 'npm', name: 'lodash' }
      const simplePurl = PackageURL.fromObject(simpleObj)

      expect(simplePurl.type).toBe('npm')
      expect(simplePurl.name).toBe('lodash')
      expect(simplePurl.namespace).toBeUndefined()
      expect(simplePurl.version).toBeUndefined()
      expect(simplePurl.qualifiers).toBeUndefined()
      expect(simplePurl.subpath).toBeUndefined()

      const completeObj = {
        type: 'npm',
        namespace: '@types',
        name: 'node',
        version: '16.11.7',
        qualifiers: { arch: 'x64', os: 'linux' },
        subpath: 'lib/fs.d.ts',
      }
      const completePurl = PackageURL.fromObject(completeObj)

      expect(completePurl.type).toBe('npm')
      expect(completePurl.namespace).toBe('@types')
      expect(completePurl.name).toBe('node')
      expect(completePurl.version).toBe('16.11.7')
      expect(completePurl.qualifiers).toEqual({ arch: 'x64', os: 'linux' })
      expect(completePurl.subpath).toBe('lib/fs.d.ts')

      const partialObj = { type: 'npm', name: 'lodash', version: '4.17.21' }
      const partialPurl = PackageURL.fromObject(partialObj)

      expect(partialPurl.type).toBe('npm')
      expect(partialPurl.name).toBe('lodash')
      expect(partialPurl.version).toBe('4.17.21')
      expect(partialPurl.namespace).toBeUndefined()
      expect(partialPurl.qualifiers).toBeUndefined()
      expect(partialPurl.subpath).toBeUndefined()
    })

    it('should validate input and throw appropriate errors', () => {
      // Test non-object inputs
      expect(() => PackageURL.fromObject('not an object')).toThrow(
        'Object argument is required.',
      )
      expect(() => PackageURL.fromObject(null)).toThrow(
        'Object argument is required.',
      )
      expect(() => PackageURL.fromObject(undefined)).toThrow(
        'Object argument is required.',
      )
      expect(() => PackageURL.fromObject(123)).toThrow(
        'Object argument is required.',
      )

      // Test validation errors
      expect(() =>
        PackageURL.fromObject({ type: 'npm', name: '', version: '1.0.0' }),
      ).toThrow()
      expect(() => PackageURL.fromObject({})).toThrow()
    })
  })

  describe('fromJSON', () => {
    it('should create PackageURL from JSON string', () => {
      const simpleJson = '{"type":"npm","name":"lodash","version":"4.17.21"}'
      const simplePurl = PackageURL.fromJSON(simpleJson)

      expect(simplePurl.type).toBe('npm')
      expect(simplePurl.name).toBe('lodash')
      expect(simplePurl.version).toBe('4.17.21')

      const completeJson = JSON.stringify({
        type: 'npm',
        namespace: '@types',
        name: 'node',
        version: '16.11.7',
        qualifiers: { arch: 'x64', os: 'linux' },
        subpath: 'lib/fs.d.ts',
      })
      const completePurl = PackageURL.fromJSON(completeJson)

      expect(completePurl.type).toBe('npm')
      expect(completePurl.namespace).toBe('@types')
      expect(completePurl.name).toBe('node')
      expect(completePurl.version).toBe('16.11.7')
      expect(completePurl.qualifiers).toEqual({ arch: 'x64', os: 'linux' })
      expect(completePurl.subpath).toBe('lib/fs.d.ts')
    })

    it('should validate input and throw appropriate errors', () => {
      // Test non-string inputs
      expect(() => PackageURL.fromJSON(123)).toThrow(
        'JSON string argument is required.',
      )
      expect(() => PackageURL.fromJSON(null)).toThrow(
        'JSON string argument is required.',
      )
      expect(() => PackageURL.fromJSON(undefined)).toThrow(
        'JSON string argument is required.',
      )
      expect(() => PackageURL.fromJSON({})).toThrow(
        'JSON string argument is required.',
      )

      // Test invalid JSON
      expect(() => PackageURL.fromJSON('invalid json')).toThrow(
        'Invalid JSON string.',
      )
      expect(() => PackageURL.fromJSON('{"type":"npm","name"}')).toThrow(
        'Invalid JSON string.',
      )
      expect(() => PackageURL.fromJSON('')).toThrow('Invalid JSON string.')

      // Test validation of created PackageURL
      expect(() =>
        PackageURL.fromJSON('{"type":"npm","name":"","version":"1.0.0"}'),
      ).toThrow()
    })
  })

  describe('round-trip conversion', () => {
    it('should preserve data through toObject -> fromObject', () => {
      const original = new PackageURL(
        'npm',
        '@types',
        'node',
        '16.11.7',
        { arch: 'x64', os: 'linux' },
        'lib/fs.d.ts',
      )
      const obj = original.toObject()
      const restored = PackageURL.fromObject(obj)

      expect(restored.type).toBe(original.type)
      expect(restored.namespace).toBe(original.namespace)
      expect(restored.name).toBe(original.name)
      expect(restored.version).toBe(original.version)
      expect(restored.qualifiers).toEqual(original.qualifiers)
      expect(restored.subpath).toBe(original.subpath)
      expect(restored.toString()).toBe(original.toString())
    })

    it('should preserve data through toJSONString -> fromJSON', () => {
      const original = new PackageURL(
        'maven',
        'org.apache.commons',
        'commons-lang3',
        '3.12.0',
        { classifier: 'sources', type: 'jar' },
        undefined,
      )
      const json = original.toJSONString()
      const restored = PackageURL.fromJSON(json)

      expect(restored.type).toBe(original.type)
      expect(restored.namespace).toBe(original.namespace)
      expect(restored.name).toBe(original.name)
      expect(restored.version).toBe(original.version)
      expect(restored.qualifiers).toEqual(original.qualifiers)
      expect(restored.subpath).toBe(original.subpath)
      expect(restored.toString()).toBe(original.toString())
    })

    it('should handle PackageURL with only required fields', () => {
      const original = new PackageURL(
        'npm',
        undefined,
        'lodash',
        undefined,
        undefined,
        undefined,
      )
      const json = original.toJSONString()
      const restored = PackageURL.fromJSON(json)

      expect(restored.type).toBe(original.type)
      expect(restored.name).toBe(original.name)
      expect(restored.namespace).toBe(original.namespace)
      expect(restored.version).toBe(original.version)
      expect(restored.qualifiers).toBe(original.qualifiers)
      expect(restored.subpath).toBe(original.subpath)
      expect(restored.toString()).toBe(original.toString())
    })

    it('should work with various package types', () => {
      const testCases = [
        new PackageURL(
          'npm',
          '@scope',
          'package',
          '1.0.0',
          undefined,
          undefined,
        ),
        new PackageURL(
          'pypi',
          undefined,
          'requests',
          '2.28.1',
          undefined,
          undefined,
        ),
        new PackageURL(
          'gem',
          undefined,
          'rails',
          '7.0.0',
          { platform: 'ruby' },
          undefined,
        ),
      ]

      for (const original of testCases) {
        const json = original.toJSONString()
        const restored = PackageURL.fromJSON(json)
        expect(restored.toString()).toBe(original.toString())
      }
    })
  })

  describe('JSON.stringify integration', () => {
    it('should work with native JSON.stringify for single objects and arrays', () => {
      const purl = new PackageURL(
        'npm',
        undefined,
        'lodash',
        '4.17.21',
        undefined,
        undefined,
      )
      const json = JSON.stringify(purl)
      const parsed = JSON.parse(json)

      expect(parsed).toEqual({
        type: 'npm',
        name: 'lodash',
        version: '4.17.21',
      })

      const purls = [
        purl,
        new PackageURL(
          'pypi',
          undefined,
          'requests',
          '2.28.1',
          undefined,
          undefined,
        ),
      ]
      const arrayJson = JSON.stringify(purls)
      const arrayParsed = JSON.parse(arrayJson)

      expect(arrayParsed).toHaveLength(2)
      expect(arrayParsed[0]).toEqual({
        type: 'npm',
        name: 'lodash',
        version: '4.17.21',
      })
      expect(arrayParsed[1]).toEqual({
        type: 'pypi',
        name: 'requests',
        version: '2.28.1',
      })
    })
  })
})
