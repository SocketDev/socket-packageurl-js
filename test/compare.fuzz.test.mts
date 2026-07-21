/**
 * @file Property/fuzz tests for src/compare (Tier-1 fast-check).
 *   `compare`/`equals` impose a total order on PURLs via their canonical
 *   string; `matches`/`createMatcher`/`parsePattern` consume UNTRUSTED pattern
 *   strings. Load-bearing properties:
 *
 *   - ORDER AXIOMS: compare is reflexive, antisymmetric, and transitive; equals
 *     agrees with compare === 0.
 *   - SORT: Array.prototype.sort(compare) is an ordered permutation.
 *   - NEVER-THROWS: parsePattern / matches / createMatcher tolerate any string.
 *   - INVARIANT: matchComponent's '**' matches everything; an empty pattern
 *     matches only an empty/absent value. PackageURL instances are CONSTRUCTED
 *     from a safe alphabet so construction always succeeds; we never
 *     reimplement the canonical-string ordering.
 */

import fc from 'fast-check'
import { describe, expect, test } from 'vitest'

import {
  compare,
  createMatcher,
  equals,
  matchComponent,
  matches,
  matchWildcard,
  parsePattern,
} from '../src/compare.mjs'
import { PackageURL } from '../src/package-url.mjs'

const LOWER = 'abcdefghijklmnopqrstuvwxyz'
const ALNUM = `${LOWER}0123456789`

// A safe, non-empty word starting with a letter — valid as a name/namespace for
// the lenient `generic` type (no injection chars, no leading-digit hazard).
const word = fc
  .tuple(
    fc.constantFrom(...LOWER),
    fc.array(fc.constantFrom(...ALNUM, '-'), { maxLength: 8 }),
  )
  .map(([head, rest]) => head + rest.join(''))

const versionArb = fc
  .array(fc.constantFrom(...ALNUM, '.', '-'), { minLength: 1, maxLength: 8 })
  .map(chars => chars.join(''))

// A constructed, always-valid PackageURL. `generic` type keeps validation
// permissive; every field is drawn from the safe alphabet above.
const purlArb: fc.Arbitrary<PackageURL> = fc
  .record({
    namespace: fc.option(word, { nil: undefined }),
    name: word,
    version: fc.option(versionArb, { nil: undefined }),
  })
  .map(
    ({ namespace, name, version }) =>
      new PackageURL('generic', namespace, name, version, undefined, undefined),
  )

function sign(n: number): -1 | 0 | 1 {
  return n > 0 ? 1 : n < 0 ? -1 : 0
}

describe('compare — fuzz', () => {
  // INVARIANT: reflexivity — a purl compares equal to itself.
  test('compare is reflexive and equals agrees', () => {
    fc.assert(
      fc.property(purlArb, p => {
        expect(compare(p, p)).toBe(0)
        expect(equals(p, p)).toBe(true)
      }),
    )
  })

  // INVARIANT: antisymmetry — swapping arguments negates the sign.
  test('compare is antisymmetric', () => {
    fc.assert(
      fc.property(purlArb, purlArb, (a, b) => {
        // Hoist both comparisons into vars so the src-imported `compare` never
        // builds the expected value inside expect().
        const ab = compare(a, b)
        const ba = compare(b, a)
        expect(sign(ab)).toBe(-sign(ba))
      }),
    )
  })

  // INVARIANT: transitivity of the ordering.
  test('compare is transitive', () => {
    fc.assert(
      fc.property(purlArb, purlArb, purlArb, (a, b, c) => {
        const ab = compare(a, b)
        const bc = compare(b, c)
        const ac = compare(a, c)
        if (ab <= 0 && bc <= 0) {
          expect(ac).toBeLessThanOrEqual(0)
        }
        if (ab >= 0 && bc >= 0) {
          expect(ac).toBeGreaterThanOrEqual(0)
        }
      }),
    )
  })

  // ORACLE (consistency): equals is true exactly when compare returns 0.
  test('equals is consistent with compare === 0', () => {
    fc.assert(
      fc.property(purlArb, purlArb, (a, b) => {
        // Compute the compare-derived expectation OUTSIDE expect() so the
        // src-imported `compare` never builds the expected value inline.
        const comparesEqual = compare(a, b) === 0
        expect(equals(a, b)).toBe(comparesEqual)
      }),
    )
  })

  // ROUND-TRIP + INVARIANT: sorting with compare yields an ordered permutation.
  test('sort(compare) is an ordered permutation', () => {
    fc.assert(
      fc.property(fc.array(purlArb, { maxLength: 10 }), purls => {
        const sorted = [...purls].toSorted(compare)
        // Same multiset (compare by canonical string).
        const key = (p: PackageURL) => p.toString()
        expect(sorted.map(key).toSorted()).toEqual(purls.map(key).toSorted())
        // Adjacent pairs are non-decreasing.
        for (let i = 1; i < sorted.length; i += 1) {
          expect(compare(sorted[i - 1]!, sorted[i]!)).not.toBe(1)
        }
      }),
    )
  })

  // NEVER-THROWS: parsePattern tolerates any string and returns an object or
  // undefined.
  test('parsePattern never throws on arbitrary input', () => {
    fc.assert(
      fc.property(fc.string(), s => {
        let threw = false
        let result: unknown
        try {
          result = parsePattern(s)
        } catch {
          threw = true
        }
        expect(threw).toBe(false)
        expect(result === undefined || typeof result === 'object').toBe(true)
      }),
    )
  })

  // NEVER-THROWS: matches + createMatcher tolerate any pattern string against a
  // valid purl and always return a boolean.
  test('matches and createMatcher never throw and return boolean', () => {
    fc.assert(
      fc.property(fc.string(), purlArb, (pattern, purl) => {
        let threw = false
        let result: unknown
        try {
          result = matches(pattern, purl)
          const matcher = createMatcher(pattern)
          const result2 = matcher(purl)
          expect(typeof result2).toBe('boolean')
        } catch {
          threw = true
        }
        expect(threw).toBe(false)
        expect(typeof result).toBe('boolean')
      }),
    )
  })

  // NEVER-THROWS: matchWildcard tolerates arbitrary pattern/value pairs — the
  // ReDoS guards must never let a crafted pattern throw or hang.
  test('matchWildcard never throws and returns boolean', () => {
    const glob = fc
      .array(
        fc.constantFrom(...ALNUM, '*', '?', '.', '\\', '(', ')', '[', ']'),
        {
          maxLength: 30,
        },
      )
      .map(chars => chars.join(''))
    fc.assert(
      fc.property(
        fc.oneof(glob, fc.string()),
        fc.string(),
        (pattern, value) => {
          let threw = false
          let result: unknown
          try {
            result = matchWildcard(pattern, value)
          } catch {
            threw = true
          }
          expect(threw).toBe(false)
          expect(typeof result).toBe('boolean')
        },
      ),
    )
  })

  // INVARIANT: matchComponent's wildcards behave per spec — '**' matches any
  // value; an empty/absent pattern matches only an empty/absent value.
  test('matchComponent double-star matches anything; empty pattern matches only empty', () => {
    const maybeValue = fc.option(word, { nil: undefined })
    fc.assert(
      fc.property(maybeValue, actual => {
        // '**' matches every possible actual value.
        expect(matchComponent('**', actual)).toBe(true)
        // An empty pattern matches iff the actual is empty/absent.
        const emptyActual =
          actual === undefined || actual === null || actual === ''
        expect(matchComponent('', actual)).toBe(emptyActual)
      }),
    )
  })
})
