import { describe, expect, it } from 'vitest'

import {
  isBlank,
  isNonEmptyString,
  isSemverString,
  localeCompare,
  lowerName,
  lowerNamespace,
  lowerVersion,
  replaceDashesWithUnderscores,
  replaceUnderscoresWithDashes,
  trimLeadingSlashes,
} from '../src/strings.js'

describe('String utilities', () => {
  describe('isBlank', () => {
    it('should return true for whitespace-only strings', () => {
      expect(isBlank('')).toBe(true)
      expect(isBlank('   ')).toBe(true)
      expect(isBlank('\t\t\t')).toBe(true)
      expect(isBlank(' \t\n\v\f\r')).toBe(true)
      // Unicode whitespace: No-Break Space, Ogham Space Mark, various Em/En spaces
      expect(isBlank('\u00a0\u1680\u2000\u2001\u2002')).toBe(true)
      expect(isBlank('\u2003\u2004\u2005\u2006\u2007')).toBe(true)
      // Line/Paragraph Separators, Narrow No-Break, Medium Math, Ideographic, BOM
      expect(isBlank('\u2028\u2029\u202f\u205f\u3000\ufeff')).toBe(true)
    })

    it('should return false for strings with non-whitespace', () => {
      expect(isBlank('a')).toBe(false)
      expect(isBlank(' a ')).toBe(false)
      expect(isBlank('\t \n test \r\n')).toBe(false)
    })
  })

  describe('isNonEmptyString', () => {
    it('should return true for non-empty strings', () => {
      expect(isNonEmptyString('test')).toBe(true)
      expect(isNonEmptyString(' ')).toBe(true)
    })

    it('should return false for empty string or non-strings', () => {
      expect(isNonEmptyString('')).toBe(false)
      expect(isNonEmptyString(null)).toBe(false)
      expect(isNonEmptyString(undefined)).toBe(false)
      expect(isNonEmptyString(123)).toBe(false)
    })
  })

  describe('isSemverString', () => {
    it('should return true for valid semver', () => {
      expect(isSemverString('1.0.0')).toBe(true)
      expect(isSemverString('0.0.0')).toBe(true)
      expect(isSemverString('1.0.0-alpha')).toBe(true)
      expect(isSemverString('1.0.0-alpha.1')).toBe(true)
      expect(isSemverString('1.0.0+20130313144700')).toBe(true)
      expect(isSemverString('1.0.0-beta+exp.sha.5114f85')).toBe(true)
    })

    it('should return false for invalid semver', () => {
      expect(isSemverString('1')).toBe(false)
      expect(isSemverString('1.2')).toBe(false)
      expect(isSemverString('v1.2.3')).toBe(false)
      // Leading zeros not allowed
      expect(isSemverString('01.2.3')).toBe(false)
      expect(isSemverString(null)).toBe(false)
    })
  })

  describe('localeCompare', () => {
    it('should compare strings correctly', () => {
      expect(localeCompare('a', 'b')).toBeLessThan(0)
      expect(localeCompare('b', 'a')).toBeGreaterThan(0)
      expect(localeCompare('a', 'a')).toBe(0)
    })

    it('should reuse Intl.Collator instance', () => {
      const result1 = localeCompare('test1', 'test2')
      const result2 = localeCompare('test1', 'test2')
      expect(result1).toBe(result2)
    })
  })

  describe('lower* functions', () => {
    it.each([
      ['name', 'MyPackage', 'mypackage', lowerName],
      ['namespace', 'MyNamespace', 'mynamespace', lowerNamespace],
      ['version', '1.0.0-BETA', '1.0.0-beta', lowerVersion],
    ])('should convert %s to lowercase', (field, input, expected, fn) => {
      const purl: any = { [field]: input }
      fn(purl)
      expect(purl[field]).toBe(expected)
    })

    it.each([
      ['namespace', lowerNamespace],
      ['version', lowerVersion],
    ])('should handle undefined %s', (field, fn) => {
      const purl: Record<string, string | undefined> = {}
      fn(purl)
      expect(purl[field]).toBeUndefined()
    })
  })

  describe('string replacement functions', () => {
    it.each([
      ['my-package-name', 'my_package_name', replaceDashesWithUnderscores],
      ['mypackage', 'mypackage', replaceDashesWithUnderscores],
      ['', '', replaceDashesWithUnderscores],
      ['---', '___', replaceDashesWithUnderscores],
      ['-package-', '_package_', replaceDashesWithUnderscores],
      ['my_package_name', 'my-package-name', replaceUnderscoresWithDashes],
      ['mypackage', 'mypackage', replaceUnderscoresWithDashes],
      ['', '', replaceUnderscoresWithDashes],
      ['___', '---', replaceUnderscoresWithDashes],
      ['_package_', '-package-', replaceUnderscoresWithDashes],
    ])('should transform %s to %s', (input, expected, fn) => {
      expect(fn(input)).toBe(expected)
    })
  })

  describe('trimLeadingSlashes', () => {
    it('should trim leading slashes', () => {
      expect(trimLeadingSlashes('/path/to/package')).toBe('path/to/package')
      expect(trimLeadingSlashes('//path/to/package')).toBe('path/to/package')
      expect(trimLeadingSlashes('path/to/package')).toBe('path/to/package')
      expect(trimLeadingSlashes('')).toBe('')
      expect(trimLeadingSlashes('///')).toBe('')
      expect(trimLeadingSlashes('/path/')).toBe('path/')
    })
  })
})
