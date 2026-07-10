/**
 * @file Tests for validate.mts — qualifier, subpath, type, and version
 *   validation.
 */
import { describe, expect, it } from 'vitest'

import { PurlError, PurlInjectionError } from '../src/error.mjs'
import {
  validateQualifierKey,
  validateQualifiers,
  validateSubpath,
  validateType,
  validateVersion,
} from '../src/validate.mjs'

describe('validate edge cases', () => {
  describe('validateQualifierKey max length', () => {
    const longKey = 'a'.repeat(257)

    it('returns false for key exceeding 256 chars (non-throwing)', () => {
      expect(validateQualifierKey(longKey, { throws: false })).toBe(false)
    })

    it('throws PurlError for key exceeding 256 chars (throwing)', () => {
      expect(() => validateQualifierKey(longKey, { throws: true })).toThrow(
        PurlError,
      )
      expect(() => validateQualifierKey(longKey, { throws: true })).toThrow(
        /maximum length of 256/,
      )
    })
  })

  describe('validateQualifiers value max length', () => {
    const longValue = 'x'.repeat(65_537)

    it('returns false for qualifier value exceeding 65536 chars (non-throwing)', () => {
      expect(validateQualifiers({ mykey: longValue }, { throws: false })).toBe(
        false,
      )
    })

    it('throws PurlError for qualifier value exceeding 65536 chars (throwing)', () => {
      expect(() =>
        validateQualifiers({ mykey: longValue }, { throws: true }),
      ).toThrow(PurlError)
      expect(() =>
        validateQualifiers({ mykey: longValue }, { throws: true }),
      ).toThrow(/maximum length of 65536/)
    })
  })

  describe('validateQualifiers command injection in value', () => {
    it('returns false for qualifier value with pipe (non-throwing)', () => {
      expect(validateQualifiers({ cmd: 'foo|bar' }, { throws: false })).toBe(
        false,
      )
    })

    it('throws PurlInjectionError for qualifier value with pipe (throwing)', () => {
      expect(() =>
        validateQualifiers({ cmd: 'foo|bar' }, { throws: true }),
      ).toThrow(PurlInjectionError)
    })

    it('returns false for qualifier value with backtick (non-throwing)', () => {
      expect(validateQualifiers({ cmd: 'foo`id`' }, { throws: false })).toBe(
        false,
      )
    })

    it('returns false for qualifier value with dollar sign', () => {
      expect(
        validateQualifiers({ cmd: 'foo$(whoami)' }, { throws: false }),
      ).toBe(false)
    })
  })

  describe('validateQualifiers non-string key via custom keys iterator', () => {
    it('returns false for non-string key (non-throwing)', () => {
      const qualifiers = {
        keys() {
          return [42 as unknown as string][Symbol.iterator]()
        },
      }
      expect(validateQualifiers(qualifiers, { throws: false })).toBe(false)
    })

    it('throws PurlError for non-string key (throwing)', () => {
      const qualifiers = {
        keys() {
          return [42 as unknown as string][Symbol.iterator]()
        },
      }
      expect(() => validateQualifiers(qualifiers, { throws: true })).toThrow(
        PurlError,
      )
    })
  })

  describe('validateSubpath command injection', () => {
    it('returns false for subpath with pipe (non-throwing)', () => {
      expect(validateSubpath('src|evil', { throws: false })).toBe(false)
    })

    it('throws PurlInjectionError for subpath with pipe (throwing)', () => {
      expect(() => validateSubpath('src|evil', { throws: true })).toThrow(
        PurlInjectionError,
      )
    })

    it('returns false for subpath with backtick (non-throwing)', () => {
      expect(validateSubpath('src`id`', { throws: false })).toBe(false)
    })

    it('returns false for non-string subpath (non-throwing)', () => {
      expect(validateSubpath(42, { throws: false })).toBe(false)
    })

    it('returns false for subpath with injection when called with no options', () => {
      expect(validateSubpath('src|evil')).toBe(false)
    })

    it('returns false for subpath with injection when throws is false', () => {
      expect(validateSubpath('src|evil', { throws: false })).toBe(false)
    })

    it('accepts valid subpath when called with undefined options', () => {
      expect(validateSubpath('src/main', undefined)).toBe(true)
    })
  })

  describe('validateType with invalid start', () => {
    it('returns false when type starts with a number', () => {
      expect(validateType('1npm', { throws: false })).toBe(false)
    })

    it('returns false for non-string type', () => {
      expect(validateType(42, { throws: false })).toBe(false)
    })
  })

  describe('validateVersion command injection', () => {
    it('returns false for version with pipe (non-throwing)', () => {
      expect(validateVersion('1.0|rm', { throws: false })).toBe(false)
    })

    it('throws PurlInjectionError for version with pipe (throwing)', () => {
      expect(() => validateVersion('1.0|rm', { throws: true })).toThrow(
        PurlInjectionError,
      )
    })

    it('returns false for version with semicolon (non-throwing)', () => {
      expect(validateVersion('1.0;rm', { throws: false })).toBe(false)
    })

    it('returns false for version with backtick', () => {
      expect(validateVersion('1.0`id`', { throws: false })).toBe(false)
    })

    it('returns false for version with dollar sign', () => {
      expect(validateVersion('1.0$(cmd)', { throws: false })).toBe(false)
    })
  })

  describe('validateStrings with null bytes', () => {
    it('rejects version containing null byte (non-throwing)', () => {
      expect(validateVersion('1.0\x00', { throws: false })).toBe(false)
    })

    it('rejects subpath containing null byte (non-throwing)', () => {
      expect(validateSubpath('src\x00', { throws: false })).toBe(false)
    })
  })
})
