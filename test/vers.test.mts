/**
 * @fileoverview Tests for VERS (VErsion Range Specifier) implementation.
 * Tests parsing, serialization, containment, and validation.
 */
import { describe, expect, it } from 'vitest'

import { PurlError } from '../src/error.js'
import { Vers } from '../src/vers.js'

describe('Vers', () => {
  describe('parse', () => {
    it('should parse basic range', () => {
      const v = Vers.parse('vers:semver/>=1.0.0|<2.0.0')
      expect(v.scheme).toBe('semver')
      expect(v.constraints).toHaveLength(2)
      expect(v.constraints[0]).toEqual({
        comparator: '>=',
        version: '1.0.0',
      })
      expect(v.constraints[1]).toEqual({
        comparator: '<',
        version: '2.0.0',
      })
    })

    it('should parse wildcard', () => {
      const v = Vers.parse('vers:semver/*')
      expect(v.constraints).toHaveLength(1)
      expect(v.constraints[0]!.comparator).toBe('*')
    })

    it('should parse bare version as equality', () => {
      const v = Vers.parse('vers:npm/1.0.0')
      expect(v.constraints).toHaveLength(1)
      expect(v.constraints[0]).toEqual({
        comparator: '=',
        version: '1.0.0',
      })
    })

    it('should parse multiple equality constraints', () => {
      const v = Vers.parse('vers:npm/1.0.0|2.0.0|3.0.0')
      expect(v.constraints).toHaveLength(3)
      for (const c of v.constraints) {
        expect(c.comparator).toBe('=')
      }
    })

    it('should parse exclusion constraints', () => {
      const v = Vers.parse('vers:semver/>=1.0.0|!=1.5.0|<2.0.0')
      expect(v.constraints).toHaveLength(3)
      expect(v.constraints[1]).toEqual({
        comparator: '!=',
        version: '1.5.0',
      })
    })

    it('should parse scheme aliases', () => {
      for (const scheme of ['npm', 'cargo', 'golang', 'gem', 'hex', 'pub']) {
        const v = Vers.parse(`vers:${scheme}/>=1.0.0`)
        expect(v.scheme).toBe(scheme)
      }
    })

    it('should lowercase the scheme', () => {
      const v = Vers.parse('vers:NPM/>=1.0.0')
      expect(v.scheme).toBe('npm')
    })

    it('should parse prerelease versions', () => {
      const v = Vers.parse('vers:semver/>=1.0.0-alpha|<2.0.0')
      expect(v.constraints[0]!.version).toBe('1.0.0-alpha')
    })
  })

  describe('parse errors', () => {
    it('should reject empty string', () => {
      expect(() => Vers.parse('')).toThrow(PurlError)
    })

    it('should reject missing vers: prefix', () => {
      expect(() => Vers.parse('npm/>=1.0.0')).toThrow(PurlError)
    })

    it('should reject missing scheme', () => {
      expect(() => Vers.parse('vers:/>=1.0.0')).toThrow(PurlError)
    })

    it('should reject missing constraints', () => {
      expect(() => Vers.parse('vers:npm/')).toThrow(PurlError)
    })

    it('should reject missing slash', () => {
      expect(() => Vers.parse('vers:npm')).toThrow(PurlError)
    })

    it('should reject wildcard with other constraints', () => {
      expect(() => Vers.parse('vers:semver/*|>=1.0.0')).toThrow(PurlError)
    })

    it('should reject invalid semver in semver scheme', () => {
      expect(() => Vers.parse('vers:semver/>=not-semver')).toThrow(PurlError)
    })

    it('should reject empty comparator version', () => {
      expect(() => Vers.parse('vers:semver/>=')).toThrow(PurlError)
    })

    it('should reject empty constraint in pipe-separated list', () => {
      expect(() => Vers.parse('vers:semver/>=1.0.0|')).toThrow(PurlError)
    })

    it('should reject non-semver version passed to parseSemver via contains', () => {
      const v = Vers.parse('vers:semver/>=1.0.0')
      expect(() => v.contains('not-semver')).toThrow(PurlError)
    })
  })

  describe('toString', () => {
    it('should roundtrip basic range', () => {
      const input = 'vers:npm/>=1.0.0|<2.0.0'
      expect(Vers.parse(input).toString()).toBe(input)
    })

    it('should roundtrip wildcard', () => {
      expect(Vers.parse('vers:semver/*').toString()).toBe('vers:semver/*')
    })

    it('should serialize bare versions without = prefix', () => {
      expect(Vers.parse('vers:npm/1.0.0').toString()).toBe('vers:npm/1.0.0')
    })

    it('should roundtrip exclusion', () => {
      const input = 'vers:npm/>=1.0.0|!=1.5.0|<2.0.0'
      expect(Vers.parse(input).toString()).toBe(input)
    })

    it('should roundtrip multiple equalities', () => {
      const input = 'vers:npm/1.0.0|2.0.0|3.0.0'
      expect(Vers.parse(input).toString()).toBe(input)
    })
  })

  describe('contains', () => {
    describe('wildcard', () => {
      it('should match any version', () => {
        const v = Vers.parse('vers:semver/*')
        expect(v.contains('0.0.1')).toBe(true)
        expect(v.contains('999.999.999')).toBe(true)
      })
    })

    describe('equality', () => {
      it('should match exact version', () => {
        const v = Vers.parse('vers:npm/1.0.0')
        expect(v.contains('1.0.0')).toBe(true)
        expect(v.contains('1.0.1')).toBe(false)
        expect(v.contains('0.9.9')).toBe(false)
      })

      it('should match any listed version', () => {
        const v = Vers.parse('vers:npm/1.0.0|2.0.0|3.0.0')
        expect(v.contains('1.0.0')).toBe(true)
        expect(v.contains('2.0.0')).toBe(true)
        expect(v.contains('3.0.0')).toBe(true)
        expect(v.contains('1.5.0')).toBe(false)
      })
    })

    describe('exclusion', () => {
      it('should exclude specific version from range', () => {
        const v = Vers.parse('vers:npm/>=1.0.0|!=1.5.0|<2.0.0')
        expect(v.contains('1.0.0')).toBe(true)
        expect(v.contains('1.4.9')).toBe(true)
        expect(v.contains('1.5.0')).toBe(false)
        expect(v.contains('1.5.1')).toBe(true)
        expect(v.contains('2.0.0')).toBe(false)
      })
    })

    describe('ranges', () => {
      it('should handle >=X|<Y range', () => {
        const v = Vers.parse('vers:npm/>=1.0.0|<2.0.0')
        expect(v.contains('0.9.9')).toBe(false)
        expect(v.contains('1.0.0')).toBe(true)
        expect(v.contains('1.5.0')).toBe(true)
        expect(v.contains('1.9.9')).toBe(true)
        expect(v.contains('2.0.0')).toBe(false)
      })

      it('should handle >=X|<=Y range', () => {
        const v = Vers.parse('vers:npm/>=1.0.0|<=2.0.0')
        expect(v.contains('1.0.0')).toBe(true)
        expect(v.contains('2.0.0')).toBe(true)
        expect(v.contains('2.0.1')).toBe(false)
      })

      it('should handle >X|<Y range', () => {
        const v = Vers.parse('vers:npm/>1.0.0|<2.0.0')
        expect(v.contains('1.0.0')).toBe(false)
        expect(v.contains('1.0.1')).toBe(true)
        expect(v.contains('1.9.9')).toBe(true)
        expect(v.contains('2.0.0')).toBe(false)
      })

      it('should handle >X|<=Y range', () => {
        const v = Vers.parse('vers:npm/>1.0.0|<=2.0.0')
        expect(v.contains('1.0.0')).toBe(false)
        expect(v.contains('1.0.1')).toBe(true)
        expect(v.contains('2.0.0')).toBe(true)
      })

      it('should handle unbounded >=X', () => {
        const v = Vers.parse('vers:semver/>=1.0.0')
        expect(v.contains('0.9.9')).toBe(false)
        expect(v.contains('1.0.0')).toBe(true)
        expect(v.contains('999.0.0')).toBe(true)
      })

      it('should handle unbounded <X', () => {
        const v = Vers.parse('vers:semver/<2.0.0')
        expect(v.contains('0.0.1')).toBe(true)
        expect(v.contains('1.9.9')).toBe(true)
        expect(v.contains('2.0.0')).toBe(false)
      })

      it('should handle unbounded <=X', () => {
        const v = Vers.parse('vers:semver/<=2.0.0')
        expect(v.contains('2.0.0')).toBe(true)
        expect(v.contains('2.0.1')).toBe(false)
      })
    })

    describe('prerelease', () => {
      it('should order prereleases before release', () => {
        const v = Vers.parse('vers:semver/>=1.0.0-alpha|<1.0.0')
        expect(v.contains('1.0.0-alpha')).toBe(true)
        expect(v.contains('1.0.0-beta')).toBe(true)
        expect(v.contains('1.0.0')).toBe(false)
      })

      it('should compare prerelease identifiers correctly', () => {
        const v = Vers.parse('vers:semver/>=1.0.0-alpha.1|<1.0.0-beta')
        expect(v.contains('1.0.0-alpha.1')).toBe(true)
        expect(v.contains('1.0.0-alpha.2')).toBe(true)
        expect(v.contains('1.0.0-beta')).toBe(false)
      })
    })

    describe('scheme aliases', () => {
      it('should support npm scheme', () => {
        const v = Vers.parse('vers:npm/>=1.0.0|<2.0.0')
        expect(v.contains('1.5.0')).toBe(true)
      })

      it('should support cargo scheme', () => {
        const v = Vers.parse('vers:cargo/>=1.0.0|<2.0.0')
        expect(v.contains('1.5.0')).toBe(true)
      })

      it('should support golang scheme', () => {
        const v = Vers.parse('vers:golang/>=1.0.0|<2.0.0')
        expect(v.contains('1.5.0')).toBe(true)
      })
    })

    describe('unsupported scheme', () => {
      it('should throw for unsupported scheme on contains()', () => {
        const v = Vers.parse('vers:deb/>=1.0.0')
        expect(() => v.contains('1.0.0')).toThrow(PurlError)
      })
    })

    describe('prerelease comparison edge cases', () => {
      it('should handle numeric vs alphanumeric prerelease identifiers', () => {
        // Numeric identifiers have lower precedence than alphanumeric
        const v = Vers.parse('vers:semver/>=1.0.0-1|<1.0.0-alpha')
        expect(v.contains('1.0.0-1')).toBe(true)
        expect(v.contains('1.0.0-2')).toBe(true)
        // numeric < alphanumeric per semver spec
        expect(v.contains('1.0.0-alpha')).toBe(false)
      })

      it('should handle alphanumeric vs numeric prerelease identifiers', () => {
        const v = Vers.parse('vers:semver/>=1.0.0-alpha|<=1.0.0-beta')
        expect(v.contains('1.0.0-alpha')).toBe(true)
        expect(v.contains('1.0.0-beta')).toBe(true)
        expect(v.contains('1.0.0-gamma')).toBe(false)
      })

      it('should handle prerelease with different identifier counts', () => {
        // More prerelease identifiers = higher precedence when all prior equal
        const v = Vers.parse('vers:semver/>=1.0.0-alpha|<1.0.0-alpha.1')
        expect(v.contains('1.0.0-alpha')).toBe(true)
        expect(v.contains('1.0.0-alpha.1')).toBe(false)
      })
    })

    describe('>X|<=Y range', () => {
      it('should handle >X|<=Y correctly', () => {
        const v = Vers.parse('vers:npm/>1.0.0|<=2.0.0')
        expect(v.contains('1.0.0')).toBe(false)
        expect(v.contains('1.0.1')).toBe(true)
        expect(v.contains('2.0.0')).toBe(true)
        expect(v.contains('2.0.1')).toBe(false)
      })
    })

    describe('>X|<Y range', () => {
      it('should handle >X|<Y correctly', () => {
        const v = Vers.parse('vers:npm/>1.0.0|<2.0.0')
        expect(v.contains('1.0.0')).toBe(false)
        expect(v.contains('1.0.1')).toBe(true)
        expect(v.contains('1.9.9')).toBe(true)
        expect(v.contains('2.0.0')).toBe(false)
      })
    })

    describe('unbounded >X', () => {
      it('should match all versions above bound', () => {
        const v = Vers.parse('vers:semver/>1.0.0')
        expect(v.contains('1.0.0')).toBe(false)
        expect(v.contains('1.0.1')).toBe(true)
        expect(v.contains('999.0.0')).toBe(true)
      })
    })

    describe('empty range results', () => {
      it('should return false when no range constraints match', () => {
        // Only != constraints, version doesn't match any
        const v = Vers.parse('vers:npm/!=1.0.0|!=2.0.0')
        // 3.0.0 is not excluded but there's no inclusive range
        expect(v.contains('3.0.0')).toBe(false)
      })

      it('should return false at end of range loop', () => {
        // Version below the lower bound of a >= range
        const v = Vers.parse('vers:npm/>=2.0.0|<3.0.0')
        expect(v.contains('1.0.0')).toBe(false)
      })
    })
  })

  describe('immutability', () => {
    it('should freeze constraints array', () => {
      const v = Vers.parse('vers:npm/>=1.0.0|<2.0.0')
      expect(Object.isFrozen(v)).toBe(true)
      expect(Object.isFrozen(v.constraints)).toBe(true)
    })
  })
})
