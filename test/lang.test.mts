/**
 * @fileoverview Unit tests for language utility functions.
 * Tests null/undefined/empty string detection utilities used throughout the codebase.
 */
import { describe, expect, it } from 'vitest'

import { isNullishOrEmptyString } from '../src/lang.js'

describe('Language utilities', () => {
  describe('isNullishOrEmptyString', () => {
    it('should return true for null, undefined, or empty string', () => {
      expect(isNullishOrEmptyString(null)).toBe(true)
      expect(isNullishOrEmptyString(undefined)).toBe(true)
      expect(isNullishOrEmptyString('')).toBe(true)
    })

    it('should return false for non-empty strings and other types', () => {
      expect(isNullishOrEmptyString('test')).toBe(false)
      expect(isNullishOrEmptyString(' ')).toBe(false)
      expect(isNullishOrEmptyString(0)).toBe(false)
      expect(isNullishOrEmptyString(false)).toBe(false)
      expect(isNullishOrEmptyString({})).toBe(false)
    })
  })
})
