/**
 * @file Tests for compare.mts — matchesPurl, createMatcher, and related
 *   utilities.
 */
import { describe, expect, it } from 'vitest'

import { createMatcher, matchesPurl } from '../src/compare.mjs'
import { PackageURL } from '../src/package-url.mjs'

describe('compare edge cases', () => {
  describe('scoped name parsing in patterns without namespace', () => {
    it('treats the second @ as the version separator', () => {
      const purl = new PackageURL(
        'generic',
        undefined,
        '@scope',
        '1.2.3',
        undefined,
        undefined,
      )

      expect(matchesPurl('pkg:generic/@scope@1.2.3', purl)).toBe(true)
    })
  })

  describe('matchWildcard pattern length rejection', () => {
    it('returns false for excessively long pattern (>4096 chars)', () => {
      const longPattern = `pkg:npm/${'*'.repeat(4097)}`
      const purl = new PackageURL(
        'npm',
        undefined,
        'lodash',
        '4.17.21',
        undefined,
        undefined,
      )
      expect(matchesPurl(longPattern, purl)).toBe(false)
    })

    it('returns false when pattern exceeds max wildcards (>32)', () => {
      // 33 wildcards in the name component — over MAX_WILDCARDS_PER_PATTERN (32)
      const manyWildcardsName = 'a*'.repeat(33)
      const pattern = `pkg:npm/${manyWildcardsName}`
      const purl = new PackageURL(
        'npm',
        undefined,
        'lodash',
        '4.17.21',
        undefined,
        undefined,
      )
      expect(matchesPurl(pattern, purl)).toBe(false)
    })

    it('keeps rejecting an over-limit pattern on every call', () => {
      // The regex cache is consulted before the length and wildcard-count
      // guards, so a rejected pattern must never reach the cache — otherwise
      // the second call would skip the guards and answer from a cache entry.
      const purl = new PackageURL(
        'npm',
        undefined,
        'lodash',
        '4.17.21',
        undefined,
        undefined,
      )
      const tooLong = `pkg:npm/${'*'.repeat(4097)}`
      const tooManyWildcards = `pkg:npm/${'a*'.repeat(33)}`
      for (let i = 0; i < 3; i += 1) {
        expect(matchesPurl(tooLong, purl)).toBe(false)
        expect(matchesPurl(tooManyWildcards, purl)).toBe(false)
      }
    })

    it('answers a cached pattern the same way on repeat calls', () => {
      const lodash = new PackageURL(
        'npm',
        undefined,
        'lodash',
        '4.17.21',
        undefined,
        undefined,
      )
      const express = new PackageURL(
        'npm',
        undefined,
        'express',
        '4.18.2',
        undefined,
        undefined,
      )
      for (let i = 0; i < 3; i += 1) {
        expect(matchesPurl('pkg:npm/lo*sh@**', lodash)).toBe(true)
        expect(matchesPurl('pkg:npm/lo*sh@**', express)).toBe(false)
      }
    })
  })

  describe('wildcard cache eviction', () => {
    it('handles many unique patterns without error', () => {
      const purl = new PackageURL(
        'npm',
        undefined,
        'lodash',
        '4.17.21',
        undefined,
        undefined,
      )
      // Generate enough unique patterns to trigger cache eviction (cache max = 1024)
      for (let i = 0; i < 1030; i += 1) {
        matchesPurl(`pkg:npm/lodash@${i}.*`, purl)
      }
      // Verify matching still works after eviction
      expect(matchesPurl('pkg:npm/lodash@4.17.21', purl)).toBe(true)
    })
  })

  describe('createMatcher exact version patterns', () => {
    it('matches exact versions without precompiling a wildcard matcher', () => {
      const matcher = createMatcher('pkg:npm/lodash@4.17.21')
      const exact = new PackageURL(
        'npm',
        undefined,
        'lodash',
        '4.17.21',
        undefined,
        undefined,
      )
      const other = new PackageURL(
        'npm',
        undefined,
        'lodash',
        '4.17.20',
        undefined,
        undefined,
      )

      expect(matcher(exact)).toBe(true)
      expect(matcher(other)).toBe(false)
    })
  })
})
