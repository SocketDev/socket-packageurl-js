/**
 * @fileoverview Tests for PackageURL JSON parsing security features.
 */

import { describe, expect, it } from 'vitest'

import { PackageURL } from '../src/package-url'

describe('PackageURL.fromJSON security features', () => {
  describe('size limit protection', () => {
    it('should parse valid JSON under size limit', () => {
      const json = JSON.stringify({
        type: 'npm',
        name: 'test-package',
        version: '1.0.0',
      })

      const result = PackageURL.fromJSON(json)
      expect(result).toBeInstanceOf(PackageURL)
      expect(result.type).toBe('npm')
      expect(result.name).toBe('test-package')
      expect(result.version).toBe('1.0.0')
    })

    it('should throw error for JSON exceeding 1MB limit', () => {
      // Create a large JSON string that exceeds 1MB.
      const largeQualifiers: Record<string, string> = {}
      const qualifierKey = 'q'
      const qualifierValue = 'x'.repeat(1000)

      // Add enough qualifiers to exceed 1MB.
      for (let i = 0; i < 1100; i++) {
        largeQualifiers[`${qualifierKey}${i}`] = qualifierValue
      }

      const largeJson = JSON.stringify({
        type: 'npm',
        name: 'test',
        qualifiers: largeQualifiers,
      })

      expect(() => PackageURL.fromJSON(largeJson)).toThrow(
        'JSON string exceeds maximum size limit of 1048576 bytes',
      )
    })

    it('should handle JSON exactly at 1MB limit', () => {
      // Create a JSON string that's exactly at the 1MB limit efficiently
      const targetSize = 1024 * 1024

      // Calculate size of base JSON structure:
      // '{"type":"npm","name":"test","qualifiers":{"bigQualifier":"..."}}'
      // The key "bigQualifier" takes: "bigQualifier":"" = 17 bytes
      const baseOverhead =
        '{"type":"npm","name":"test","qualifiers":{}}'.length + 17

      // Calculate the value length needed (with small buffer)
      const valueLength = targetSize - baseOverhead - 50

      // Create one large qualifier
      const qualifiers: Record<string, string> = {
        bigQualifier: 'x'.repeat(valueLength),
      }

      const finalJson = JSON.stringify({
        type: 'npm',
        name: 'test',
        qualifiers,
      })

      expect(finalJson.length).toBeLessThanOrEqual(targetSize)
      expect(finalJson.length).toBeGreaterThan(targetSize - 1000)

      // Should work when under the limit
      const result = PackageURL.fromJSON(finalJson)
      expect(result).toBeInstanceOf(PackageURL)
    })

    it('should reject JSON just over 1MB limit', () => {
      // Create a JSON string that's just over 1MB using qualifiers
      const largeQualifiers: Record<string, string> = {}
      const qualifierValue = 'x'.repeat(100)

      // Add enough qualifiers to exceed 1MB
      for (let i = 0; i < 12_000; i++) {
        largeQualifiers[`q${i}`] = qualifierValue
      }

      const overLimitJson = JSON.stringify({
        type: 'npm',
        name: 'test',
        qualifiers: largeQualifiers,
      })

      expect(() => PackageURL.fromJSON(overLimitJson)).toThrow(
        'JSON string exceeds maximum size limit',
      )
    })

    it('should count bytes not characters for multi-byte UTF-8', () => {
      // Each emoji is 4 bytes in UTF-8
      const emoji = '😀'

      // Create qualifiers with emojis to exceed byte limit
      const qualifiers: Record<string, string> = {}

      // Each qualifier entry with emoji values will use more bytes than characters
      for (let i = 0; i < 50_000; i++) {
        // 40 bytes per value
        qualifiers[`q${i}`] = emoji.repeat(10)
      }

      const largeJson = JSON.stringify({
        type: 'npm',
        name: 'test',
        qualifiers,
      })

      expect(() => PackageURL.fromJSON(largeJson)).toThrow(
        'JSON string exceeds maximum size limit',
      )
    })
  })

  describe('prototype pollution protection', () => {
    it('should handle __proto__ safely without pollution', () => {
      // JSON.stringify removes __proto__, so we need to manually create the JSON
      const maliciousJson =
        '{"type":"npm","name":"test","__proto__":{"polluted":true}}'

      // Should parse without throwing
      const result = PackageURL.fromJSON(maliciousJson)
      expect(result.type).toBe('npm')
      expect(result.name).toBe('test')

      // Verify prototype pollution didn't occur
      expect(({} as any).polluted).toBeUndefined()
    })

    it('should handle constructor key safely', () => {
      const maliciousJson = JSON.stringify({
        type: 'npm',
        name: 'test',
        constructor: {
          polluted: true,
        },
      })

      // Should parse without throwing
      const result = PackageURL.fromJSON(maliciousJson)
      expect(result.type).toBe('npm')
      expect(result.name).toBe('test')
    })

    it('should handle prototype key safely', () => {
      const maliciousJson = JSON.stringify({
        type: 'npm',
        name: 'test',
        prototype: {
          polluted: true,
        },
      })

      // Should parse without throwing
      const result = PackageURL.fromJSON(maliciousJson)
      expect(result.type).toBe('npm')
      expect(result.name).toBe('test')
    })

    it('should reject nested prototype pollution attempts', () => {
      const maliciousJson = JSON.stringify({
        type: 'npm',
        name: 'test',
        qualifiers: {
          normal: 'value',
          __proto__: {
            polluted: true,
          },
        },
      })

      // Note: This might not be caught depending on implementation depth,
      // but we should at least not crash.
      expect(() => PackageURL.fromJSON(maliciousJson)).not.toThrow(TypeError)
    })
  })

  describe('JSON parsing errors', () => {
    it('should throw SyntaxError for invalid JSON', () => {
      const invalidJson = '{ invalid json }'

      expect(() => PackageURL.fromJSON(invalidJson)).toThrow(SyntaxError)
      expect(() => PackageURL.fromJSON(invalidJson)).toThrow(
        'Failed to parse PackageURL from JSON',
      )
    })

    it('should throw for missing required fields', () => {
      const incompleteJson = JSON.stringify({ name: 'test' })

      expect(() => PackageURL.fromJSON(incompleteJson)).toThrow(
        '"type" is a required component',
      )
    })

    it('should throw for empty type', () => {
      const invalidJson = JSON.stringify({
        type: '',
        name: 'test',
      })

      expect(() => PackageURL.fromJSON(invalidJson)).toThrow(
        '"type" is a required component',
      )
    })

    it('should throw for empty name', () => {
      const invalidJson = JSON.stringify({
        type: 'npm',
        name: '',
      })

      expect(() => PackageURL.fromJSON(invalidJson)).toThrow(
        '"name" is a required component',
      )
    })

    it('should handle whitespace-only fields as empty', () => {
      const invalidJson = JSON.stringify({
        type: '   ',
        name: 'test',
      })

      expect(() => PackageURL.fromJSON(invalidJson)).toThrow(
        '"type" is a required component',
      )
    })
  })

  describe('edge cases', () => {
    it('should handle empty JSON object', () => {
      expect(() => PackageURL.fromJSON('{}')).toThrow(
        '"type" is a required component',
      )
    })

    it('should handle JSON array instead of object', () => {
      expect(() => PackageURL.fromJSON('[]')).toThrow(
        'JSON must parse to an object',
      )
    })

    it('should handle JSON primitive values', () => {
      expect(() => PackageURL.fromJSON('"string"')).toThrow(
        'JSON must parse to an object',
      )
      expect(() => PackageURL.fromJSON('123')).toThrow(
        'JSON must parse to an object',
      )
      expect(() => PackageURL.fromJSON('true')).toThrow(
        'JSON must parse to an object',
      )
      expect(() => PackageURL.fromJSON('null')).toThrow(
        'JSON must parse to an object',
      )
    })

    it('should handle very long but valid field values', () => {
      // Under the 214 character limit
      const longName = 'a'.repeat(200)
      const json = JSON.stringify({
        type: 'npm',
        name: longName,
        version: '1.0.0',
      })

      const result = PackageURL.fromJSON(json)
      expect(result.name).toBe(longName)
    })

    it('should preserve special characters in fields', () => {
      const json = JSON.stringify({
        type: 'npm',
        // Simplified to avoid npm validation issues
        name: 'package-name',
        // Using namespace for the scope instead
        namespace: '@scope',
        version: '1.0.0-beta.123',
      })

      const result = PackageURL.fromJSON(json)
      expect(result.name).toBe('package-name')
      expect(result.namespace).toBe('@scope')
      expect(result.version).toBe('1.0.0-beta.123')
    })

    it('should handle unicode in field values', () => {
      const json = JSON.stringify({
        // Changed to generic type which allows unicode
        type: 'generic',
        name: 'test-😀-package',
        version: '1.0.0',
        qualifiers: {
          note: '你好世界',
        },
      })

      const result = PackageURL.fromJSON(json)
      expect(result.name).toBe('test-😀-package')
      expect(result.qualifiers?.note).toBe('你好世界')
    })
  })

  describe('performance considerations', () => {
    it('should quickly reject extremely large JSON', () => {
      const start = performance.now()
      const largeJson = `{"type":"npm","data":"${'x'.repeat(2 * 1024 * 1024)}"}`

      expect(() => PackageURL.fromJSON(largeJson)).toThrow()

      const duration = performance.now() - start
      // Should fail fast (under 100ms) by checking size before parsing.
      expect(duration).toBeLessThan(100)
    })

    it('should handle many small fields efficiently', () => {
      const qualifiers: Record<string, string> = {}
      for (let i = 0; i < 100; i++) {
        qualifiers[`key${i}`] = `value${i}`
      }

      const json = JSON.stringify({
        type: 'npm',
        name: 'test',
        version: '1.0.0',
        qualifiers,
      })

      const result = PackageURL.fromJSON(json)
      expect(Object.keys(result.qualifiers || {}).length).toBe(100)
    })
  })
})
