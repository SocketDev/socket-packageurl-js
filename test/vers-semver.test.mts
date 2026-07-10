/**
 * @file Tests for vers-semver.mts — comparePrereleases and related utilities.
 */
import { describe, expect, it } from 'vitest'

import { comparePrereleases } from '../src/vers-semver.mjs'

describe('comparePrereleases', () => {
  it('should treat differently-formatted equal numeric identifiers as equal', () => {
    // comparePrereleases trusts its inputs; Vers.fromString validates the
    // semver grammar upstream (no leading zero on a numeric identifier), so
    // this diff-is-zero path is unreachable through Vers — only through a
    // direct call with a looser input.
    expect(comparePrereleases(['01'], ['1'])).toBe(0)
  })

  it('should return equal precedence when neither non-numeric identifier compares less or greater', () => {
    // comparePrereleases is typed for string[] but does not enforce it at
    // runtime. NaN is neither "<" nor ">" than itself, so a value that
    // stringifies as non-numeric but isn't a real string reaches the
    // alphanumeric branch without either comparison holding.
    expect(
      comparePrereleases(
        [NaN as unknown as string],
        [NaN as unknown as string],
      ),
    ).toBe(0)
  })
})
