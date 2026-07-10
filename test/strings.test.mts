/**
 * @file Unit tests for string manipulation utilities. Tests string validation,
 *   normalization, transformation, and comparison functions including
 *   whitespace detection, semver validation, case conversion, and character
 *   replacement.
 */
import { describe, expect, it } from 'vitest'

import {
  containsInjectionCharacters,
  findCommandInjectionCharCode,
  findInjectionCharCode,
  formatInjectionChar,
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
} from '../src/strings.mjs'

describe('String utilities', () => {
  describe('containsInjectionCharacters', () => {
    it('should return false for valid package identifier characters', () => {
      expect(containsInjectionCharacters('ms-python')).toBe(false)
      expect(containsInjectionCharacters('python')).toBe(false)
      expect(containsInjectionCharacters('1.0.0')).toBe(false)
      expect(containsInjectionCharacters('1.0.0-alpha.1+build.2')).toBe(false)
      expect(containsInjectionCharacters('linux-x64')).toBe(false)
      expect(containsInjectionCharacters('@scope/name')).toBe(false)
      expect(containsInjectionCharacters('my_package')).toBe(false)
      expect(containsInjectionCharacters('')).toBe(false)
    })

    it('should detect illegal special characters', () => {
      // Pipe, ampersand, semicolon
      expect(containsInjectionCharacters('a|b')).toBe(true)
      expect(containsInjectionCharacters('a&b')).toBe(true)
      expect(containsInjectionCharacters('a;b')).toBe(true)
      // Backtick, dollar
      expect(containsInjectionCharacters('a`b`')).toBe(true)
      expect(containsInjectionCharacters('a$(b)')).toBe(true)
      // Angle brackets, braces
      expect(containsInjectionCharacters('a<b')).toBe(true)
      expect(containsInjectionCharacters('a>b')).toBe(true)
      expect(containsInjectionCharacters('a{b}')).toBe(true)
      // Hash, backslash, parentheses
      expect(containsInjectionCharacters('a#b')).toBe(true)
      expect(containsInjectionCharacters('a\\b')).toBe(true)
      expect(containsInjectionCharacters('a(b)')).toBe(true)
    })

    it('should detect embedded whitespace', () => {
      expect(containsInjectionCharacters('a b')).toBe(true)
      expect(containsInjectionCharacters('a\tb')).toBe(true)
      expect(containsInjectionCharacters('a\nb')).toBe(true)
      expect(containsInjectionCharacters('a\rb')).toBe(true)
    })

    it('should detect quote characters', () => {
      expect(containsInjectionCharacters("a'b")).toBe(true)
      expect(containsInjectionCharacters('a"b')).toBe(true)
    })

    it('should detect control characters', () => {
      // NUL
      expect(containsInjectionCharacters('a\x00b')).toBe(true)
      // ESC (terminal escape sequences)
      expect(containsInjectionCharacters('a\x1bb')).toBe(true)
      // BEL
      expect(containsInjectionCharacters('a\x07b')).toBe(true)
      // DEL
      expect(containsInjectionCharacters('a\x7fb')).toBe(true)
    })
  })

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
      expect(isNonEmptyString(undefined)).toBe(false)
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
      expect(isSemverString(undefined)).toBe(false)
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
      const purl: Record<string, string> = { [field]: input }
      ;(fn as (p: Record<string, string>) => void)(purl)
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

describe('strings edge cases', () => {
  describe('isInjectionCharCode — C1 control characters', () => {
    it('detects C1 control character 0x80', () => {
      expect(containsInjectionCharacters(String.fromCodePoint(0x80))).toBe(true)
    })

    it('detects C1 control character 0x9f', () => {
      expect(containsInjectionCharacters(String.fromCodePoint(0x9f))).toBe(true)
    })
  })

  describe('isInjectionCharCode — Unicode dangerous characters', () => {
    it('detects zero-width space (0x200b)', () => {
      expect(containsInjectionCharacters(String.fromCodePoint(0x20_0b))).toBe(
        true,
      )
    })

    it('detects right-to-left override (0x202e)', () => {
      expect(containsInjectionCharacters(String.fromCodePoint(0x20_2e))).toBe(
        true,
      )
    })

    it('detects BOM / ZWNBSP (0xfeff)', () => {
      expect(containsInjectionCharacters(String.fromCodePoint(0xfe_ff))).toBe(
        true,
      )
    })

    it('detects replacement character (0xfffd)', () => {
      expect(containsInjectionCharacters(String.fromCodePoint(0xff_fd))).toBe(
        true,
      )
    })
  })

  describe('isCommandInjectionCharCode — C0 control chars', () => {
    it('detects null byte (0x00)', () => {
      expect(findCommandInjectionCharCode(String.fromCodePoint(0))).toBe(0)
    })

    it('does not flag tab (0x09)', () => {
      expect(findCommandInjectionCharCode(String.fromCodePoint(0x9))).toBe(-1)
    })

    it('detects escape (0x1b)', () => {
      expect(findCommandInjectionCharCode(String.fromCodePoint(0x1b))).toBe(
        0x1b,
      )
    })
  })

  describe('isCommandInjectionCharCode — C1 control characters', () => {
    it('detects 0x80', () => {
      expect(findCommandInjectionCharCode(String.fromCodePoint(0x80))).toBe(
        0x80,
      )
    })

    it('detects 0x9f', () => {
      expect(findCommandInjectionCharCode(String.fromCodePoint(0x9f))).toBe(
        0x9f,
      )
    })
  })

  describe('isCommandInjectionCharCode — Unicode dangerous characters', () => {
    it('detects zero-width space (0x200b)', () => {
      expect(findCommandInjectionCharCode(String.fromCodePoint(0x20_0b))).toBe(
        0x20_0b,
      )
    })

    it('detects right-to-left override (0x202e)', () => {
      expect(findCommandInjectionCharCode(String.fromCodePoint(0x20_2e))).toBe(
        0x20_2e,
      )
    })

    it('detects BOM (0xfeff)', () => {
      expect(findCommandInjectionCharCode(String.fromCodePoint(0xfe_ff))).toBe(
        0xfe_ff,
      )
    })

    it('detects replacement character (0xfffd)', () => {
      expect(findCommandInjectionCharCode(String.fromCodePoint(0xff_fd))).toBe(
        0xff_fd,
      )
    })
  })
})

describe('Hardened scanner - newly detected characters', () => {
  it('should detect single and double quotes', () => {
    expect(containsInjectionCharacters("pkg'name")).toBe(true)
    expect(containsInjectionCharacters('pkg"name')).toBe(true)
  })

  it('should detect control characters (C0 range)', () => {
    // ESC (terminal escape sequences)
    expect(containsInjectionCharacters('pkg\x1bname')).toBe(true)
    // NUL
    expect(containsInjectionCharacters('pkg\x00name')).toBe(true)
    // BEL (terminal bell)
    expect(containsInjectionCharacters('pkg\x07name')).toBe(true)
    // Vertical tab
    expect(containsInjectionCharacters('pkg\x0bname')).toBe(true)
    // Form feed
    expect(containsInjectionCharacters('pkg\x0cname')).toBe(true)
  })

  it('should detect DEL character', () => {
    expect(containsInjectionCharacters('pkg\x7fname')).toBe(true)
  })
})

describe('findInjectionCharCode', () => {
  it('should return -1 for clean strings', () => {
    expect(findInjectionCharCode('valid-name')).toBe(-1)
    expect(findInjectionCharCode('my_package.v2')).toBe(-1)
  })

  it('should return the char code of the first injection character', () => {
    expect(findInjectionCharCode('pkg|name')).toBe(0x7c)
    expect(findInjectionCharCode('pkg$name')).toBe(0x24)
    expect(findInjectionCharCode('pkg\x1bname')).toBe(0x1b)
  })
})

describe('formatInjectionChar', () => {
  it('should format printable characters with quotes and hex', () => {
    expect(formatInjectionChar(0x7c)).toBe('"|" (0x7c)')
    expect(formatInjectionChar(0x24)).toBe('"$" (0x24)')
    expect(formatInjectionChar(0x20)).toBe('" " (0x20)')
  })

  it('should format control characters as hex only', () => {
    expect(formatInjectionChar(0x00)).toBe('0x00')
    expect(formatInjectionChar(0x1b)).toBe('0x1b')
    expect(formatInjectionChar(0x0a)).toBe('0x0a')
  })

  it('should format DEL as hex only', () => {
    expect(formatInjectionChar(0x7f)).toBe('0x7f')
  })
})
