/**
 * @file Tests for VERS (VErsion Range Specifier) implementation. Tests parsing,
 *   serialization, and validation. Containment (contains) coverage lives in
 *   vers-contains.test.mts.
 */
import { describe, expect, it } from 'vitest'

import { PurlError } from '../src/error.mjs'
import { validateCanonicalConstraints, Vers } from '../src/vers.mjs'
import type { VersConstraint } from '../src/vers.mjs'

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
      expect(v.constraints[0].comparator).toBe('*')
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
      expect(v.constraints[0].version).toBe('1.0.0-alpha')
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

    it('should reject version components exceeding MAX_SAFE_INTEGER', () => {
      const v = Vers.parse('vers:semver/>=99999999999999999.0.0')
      expect(() => v.contains('1.0.0')).toThrow(PurlError)
    })

    it('should reject too many constraints', () => {
      const many = Array(1001).fill('>=1.0.0').join('|')
      expect(() => Vers.parse(`vers:semver/${many}`)).toThrow(PurlError)
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

  describe('immutability', () => {
    it('should freeze constraints array', () => {
      const v = Vers.parse('vers:npm/>=1.0.0|<2.0.0')
      expect(Object.isFrozen(v)).toBe(true)
      expect(Object.isFrozen(v.constraints)).toBe(true)
    })
  })

  describe('canonical-form validation', () => {
    it('should reject whitespace anywhere in the string', () => {
      expect(() => Vers.parse('vers:npm/>=1.0.0 |<2.0.0')).toThrow(PurlError)
      expect(() => Vers.parse('vers:npm/ >=1.0.0|<2.0.0')).toThrow(
        'must not contain whitespace',
      )
      expect(() => Vers.parse('vers:npm/>=1.0.0|<2.0.0\n')).toThrow(PurlError)
    })

    it('should reject constraints not sorted by version', () => {
      expect(() => Vers.parse('vers:npm/<5.0.0|>=2.0.0')).toThrow(
        'must be sorted by version',
      )
    })

    it('should reject duplicate versions regardless of comparator', () => {
      expect(() => Vers.parse('vers:npm/>=1.0.0|<=1.0.0')).toThrow(
        'must be unique',
      )
    })

    it('should reject consecutive lower bounds', () => {
      expect(() => Vers.parse('vers:npm/>=1.0.0|>=2.0.0')).toThrow(
        'must alternate between lower and upper bounds',
      )
    })

    it('should reject consecutive upper bounds', () => {
      expect(() => Vers.parse('vers:npm/<1.0.0|<2.0.0')).toThrow(
        'must alternate between lower and upper bounds',
      )
    })

    it('should reject "=" followed by an upper bound', () => {
      expect(() => Vers.parse('vers:npm/1.0.0|<2.0.0')).toThrow(
        'may only be followed by',
      )
    })

    it('should accept "=" followed by a lower bound', () => {
      const v = Vers.parse('vers:npm/1.0.0|>=2.0.0|<3.0.0')
      expect(v.contains('1.0.0')).toBe(true)
      expect(v.contains('2.5.0')).toBe(true)
      expect(v.contains('1.5.0')).toBe(false)
    })

    it('should accept "!=" between range bounds without breaking alternation', () => {
      const v = Vers.parse('vers:npm/>=1.0.0|!=1.5.0|<2.0.0')
      expect(v.contains('1.4.0')).toBe(true)
      expect(v.contains('1.5.0')).toBe(false)
    })
  })

  describe('percent-quoted versions', () => {
    it('should unquote a quoted version on parse and requote on toString', () => {
      // A generic (non-semver) scheme can carry quoted separator chars.
      const v = Vers.parse('vers:generic/%3E%3D1.0')
      expect(v.constraints[0]).toEqual({ comparator: '=', version: '>=1.0' })
      expect(v.toString()).toBe('vers:generic/%3E%3D1.0')
    })
  })
})

describe('validateCanonicalConstraints', () => {
  it('should skip the sorted-order check when either side of a pair is a wildcard', () => {
    // Vers.fromString rejects a wildcard mixed with other constraints before
    // it ever reaches validateCanonicalConstraints, so this continue path is
    // only reachable via a direct call with a hand-built constraint list.
    const constraints: VersConstraint[] = [
      { comparator: '*', version: '*' },
      { comparator: '>=', version: '1.0.0' },
      { comparator: '<', version: '2.0.0' },
    ]
    expect(() => validateCanonicalConstraints('npm', constraints)).not.toThrow()
  })
})
