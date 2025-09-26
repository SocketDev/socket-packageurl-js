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

import { PackageURL } from '../src/package-url.js'

describe('PackageURL JSON/dict export', () => {
  describe('toObject', () => {
    it('should convert simple PackageURL to object', () => {
      const purl = new PackageURL(
        'npm',
        undefined,
        'lodash',
        undefined,
        undefined,
        undefined,
      )
      const obj = purl.toObject()

      expect(obj).toEqual({
        type: 'npm',
        name: 'lodash',
      })
    })

    it('should convert complete PackageURL to object', () => {
      const purl = new PackageURL(
        'npm',
        '@types',
        'node',
        '16.11.7',
        { arch: 'x64', os: 'linux' },
        'lib/fs.d.ts',
      )
      const obj = purl.toObject()

      expect(obj).toEqual({
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

      expect(obj.qualifiers).toEqual(qualifiers)
      expect(obj.qualifiers).not.toBe(qualifiers) // Should be a copy, not the same reference
    })
  })

  describe('toJSONString', () => {
    it('should convert PackageURL to JSON string', () => {
      const purl = new PackageURL(
        'npm',
        undefined,
        'lodash',
        '4.17.21',
        undefined,
        undefined,
      )
      const json = purl.toJSONString()

      expect(json).toBe('{"type":"npm","name":"lodash","version":"4.17.21"}')
    })

    it('should convert complete PackageURL to JSON string', () => {
      const purl = new PackageURL(
        'npm',
        '@types',
        'node',
        '16.11.7',
        { arch: 'x64' },
        'lib/fs.d.ts',
      )
      const json = purl.toJSONString()
      const parsed = JSON.parse(json)

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
    it('should return object for JSON.stringify', () => {
      const purl = new PackageURL(
        'npm',
        undefined,
        'lodash',
        '4.17.21',
        undefined,
        undefined,
      )
      const result = purl.toJSON()

      expect(result).toEqual({
        type: 'npm',
        name: 'lodash',
        version: '4.17.21',
      })
    })

    it('should be consistent with toObject', () => {
      const purl = new PackageURL(
        'npm',
        '@types',
        'node',
        '16.11.7',
        { arch: 'x64' },
        'lib/fs.d.ts',
      )
      const jsonResult = purl.toJSON()
      const objResult = purl.toObject()

      expect(jsonResult).toEqual(objResult)
    })
  })

  describe('fromObject', () => {
    it('should create PackageURL from simple object', () => {
      const obj = { type: 'npm', name: 'lodash' }
      const purl = PackageURL.fromObject(obj)

      expect(purl.type).toBe('npm')
      expect(purl.name).toBe('lodash')
      expect(purl.namespace).toBeUndefined()
      expect(purl.version).toBeUndefined()
      expect(purl.qualifiers).toBeUndefined()
      expect(purl.subpath).toBeUndefined()
    })

    it('should create PackageURL from complete object', () => {
      const obj = {
        type: 'npm',
        namespace: '@types',
        name: 'node',
        version: '16.11.7',
        qualifiers: { arch: 'x64', os: 'linux' },
        subpath: 'lib/fs.d.ts',
      }
      const purl = PackageURL.fromObject(obj)

      expect(purl.type).toBe('npm')
      expect(purl.namespace).toBe('@types')
      expect(purl.name).toBe('node')
      expect(purl.version).toBe('16.11.7')
      expect(purl.qualifiers).toEqual({ arch: 'x64', os: 'linux' })
      expect(purl.subpath).toBe('lib/fs.d.ts')
    })

    it('should handle missing optional fields', () => {
      const obj = { type: 'npm', name: 'lodash', version: '4.17.21' }
      const purl = PackageURL.fromObject(obj)

      expect(purl.type).toBe('npm')
      expect(purl.name).toBe('lodash')
      expect(purl.version).toBe('4.17.21')
      expect(purl.namespace).toBeUndefined()
      expect(purl.qualifiers).toBeUndefined()
      expect(purl.subpath).toBeUndefined()
    })

    it('should throw error for non-object input', () => {
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
    })

    it('should validate the created PackageURL', () => {
      const obj = { type: 'npm', name: '', version: '1.0.0' }
      expect(() => PackageURL.fromObject(obj)).toThrow()
    })

    it('should handle empty object', () => {
      const obj = {}
      expect(() => PackageURL.fromObject(obj)).toThrow()
    })
  })

  describe('fromJSON', () => {
    it('should create PackageURL from JSON string', () => {
      const json = '{"type":"npm","name":"lodash","version":"4.17.21"}'
      const purl = PackageURL.fromJSON(json)

      expect(purl.type).toBe('npm')
      expect(purl.name).toBe('lodash')
      expect(purl.version).toBe('4.17.21')
    })

    it('should create PackageURL from complete JSON', () => {
      const json = JSON.stringify({
        type: 'npm',
        namespace: '@types',
        name: 'node',
        version: '16.11.7',
        qualifiers: { arch: 'x64', os: 'linux' },
        subpath: 'lib/fs.d.ts',
      })
      const purl = PackageURL.fromJSON(json)

      expect(purl.type).toBe('npm')
      expect(purl.namespace).toBe('@types')
      expect(purl.name).toBe('node')
      expect(purl.version).toBe('16.11.7')
      expect(purl.qualifiers).toEqual({ arch: 'x64', os: 'linux' })
      expect(purl.subpath).toBe('lib/fs.d.ts')
    })

    it('should throw error for non-string input', () => {
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
    })

    it('should throw error for invalid JSON', () => {
      expect(() => PackageURL.fromJSON('invalid json')).toThrow(
        'Invalid JSON string.',
      )
      expect(() => PackageURL.fromJSON('{"type":"npm","name"}')).toThrow(
        'Invalid JSON string.',
      )
      expect(() => PackageURL.fromJSON('')).toThrow('Invalid JSON string.')
    })

    it('should validate the created PackageURL', () => {
      const json = '{"type":"npm","name":"","version":"1.0.0"}'
      expect(() => PackageURL.fromJSON(json)).toThrow()
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
    it('should work with native JSON.stringify', () => {
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
    })

    it('should work in arrays with JSON.stringify', () => {
      const purls = [
        new PackageURL(
          'npm',
          undefined,
          'lodash',
          '4.17.21',
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
      ]
      const json = JSON.stringify(purls)
      const parsed = JSON.parse(json)

      expect(parsed).toHaveLength(2)
      expect(parsed[0]).toEqual({
        type: 'npm',
        name: 'lodash',
        version: '4.17.21',
      })
      expect(parsed[1]).toEqual({
        type: 'pypi',
        name: 'requests',
        version: '2.28.1',
      })
    })
  })
})
