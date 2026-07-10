/**
 * @file Tests for Vers.prototype.contains — wildcard, equality, exclusion,
 *   bounded and disjoint ranges, prerelease ordering, scheme aliases, and
 *   semver comparison edge cases.
 */
import { describe, expect, it } from 'vitest'

import { PurlError } from '../src/error.mjs'
import { Vers } from '../src/vers.mjs'

describe('Vers', () => {
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

      it('should handle multiple disjoint ranges', () => {
        // Vulnerability reintroduced in a later version range
        const v = Vers.parse('vers:npm/>=1.0.0|<2.0.0|>=3.0.0|<4.0.0')
        // First range
        expect(v.contains('1.0.0')).toBe(true)
        expect(v.contains('1.5.0')).toBe(true)
        expect(v.contains('1.9.9')).toBe(true)
        // Gap between ranges
        expect(v.contains('2.0.0')).toBe(false)
        expect(v.contains('2.5.0')).toBe(false)
        expect(v.contains('2.9.9')).toBe(false)
        // Second range
        expect(v.contains('3.0.0')).toBe(true)
        expect(v.contains('3.5.0')).toBe(true)
        expect(v.contains('3.9.9')).toBe(true)
        // Beyond all ranges
        expect(v.contains('4.0.0')).toBe(false)
        expect(v.contains('0.9.9')).toBe(false)
      })

      it('should handle three disjoint ranges', () => {
        const v = Vers.parse(
          'vers:npm/>=1.0.0|<2.0.0|>=3.0.0|<4.0.0|>=5.0.0|<6.0.0',
        )
        expect(v.contains('1.5.0')).toBe(true)
        expect(v.contains('2.5.0')).toBe(false)
        expect(v.contains('3.5.0')).toBe(true)
        expect(v.contains('4.5.0')).toBe(false)
        expect(v.contains('5.5.0')).toBe(true)
        expect(v.contains('6.0.0')).toBe(false)
      })

      it('should handle disjoint ranges with > and <=', () => {
        const v = Vers.parse('vers:npm/>1.0.0|<=2.0.0|>3.0.0|<=4.0.0')
        expect(v.contains('1.0.0')).toBe(false)
        expect(v.contains('1.0.1')).toBe(true)
        expect(v.contains('2.0.0')).toBe(true)
        expect(v.contains('2.5.0')).toBe(false)
        expect(v.contains('3.0.0')).toBe(false)
        expect(v.contains('3.0.1')).toBe(true)
        expect(v.contains('4.0.0')).toBe(true)
        expect(v.contains('4.0.1')).toBe(false)
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
})

describe('Vers.prototype.contains', () => {
  it('should skip a disjoint upper bound expressed as "<=" when below the paired lower bound', () => {
    // The existing disjoint-range coverage only pairs a skipped ">=" with a
    // "<" upper bound; this drives the "<=" side of that same skip check.
    const v = Vers.fromString('vers:npm/>=3.0.0|<=4.0.0')
    expect(v.contains('1.0.0')).toBe(false)
  })
})

describe('vers edge cases', () => {
  it('compares differing numeric prerelease identifiers', () => {
    const vers = Vers.parse('vers:semver/>=1.0.0-1')

    expect(vers.contains('1.0.0-2')).toBe(true)
    expect(vers.contains('1.0.0-0')).toBe(false)
  })

  it('orders numeric prerelease identifiers before alphanumeric ones', () => {
    const vers = Vers.parse('vers:semver/>=1.0.0-alpha.1')

    expect(vers.contains('1.0.0-alpha.beta')).toBe(true)
    expect(vers.contains('1.0.0-alpha.0')).toBe(false)
  })

  it('compares alphanumeric prerelease identifiers lexicographically', () => {
    const vers = Vers.parse('vers:semver/>=1.0.0-alpha.beta')

    expect(vers.contains('1.0.0-alpha.gamma')).toBe(true)
    expect(vers.contains('1.0.0-alpha.alpha')).toBe(false)
  })

  it('uses patch comparison before prerelease comparison', () => {
    const vers = Vers.parse('vers:semver/<1.0.1-alpha')

    expect(vers.contains('1.0.0-zeta')).toBe(true)
    expect(vers.contains('1.0.1-0')).toBe(true)
    expect(vers.contains('1.0.1-alpha')).toBe(false)
  })

  it('skips a non-matching lower bound and continues to the next range pair', () => {
    const vers = Vers.parse('vers:semver/>=2.0.0|<3.0.0|>=4.0.0|<5.0.0')

    expect(vers.contains('4.5.0')).toBe(true)
    expect(vers.contains('3.5.0')).toBe(false)
  })

  it('handles a leading upper-bound range without a preceding lower bound', () => {
    const vers = Vers.parse('vers:semver/<2.0.0|>=3.0.0')

    expect(vers.contains('1.5.0')).toBe(true)
    expect(vers.contains('2.5.0')).toBe(false)
    expect(vers.contains('3.1.0')).toBe(true)
  })
})
