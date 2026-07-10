/* max-file-lines: parser — single-file VERS spec implementation; the tokenizer, parser, and version-range matcher share an internal state machine that splitting would tangle. */
/**
 * @file VERS (VErsion Range Specifier) implementation. Implements the VERS
 *   specification for version range matching. VERS is a companion standard to
 *   PURL, currently in pre-standard draft with Ecma submission planned for late
 *   2026. **Early adoption warning:** The VERS spec is not yet finalized. This
 *   implementation covers the semver scheme and common aliases (`npm`, `cargo`,
 *   `golang`, etc.). Additional version schemes may be added as the spec
 *   matures.
 *
 * @see https://github.com/package-url/vers-spec
 */

import { PurlError } from './error.mjs'
import {
  ArrayPrototypeJoin,
  ArrayPrototypePush,
} from '@socketsecurity/lib/primordials/array'
import { decodeURIComponent as GlobalDecodeUriComponent } from '@socketsecurity/lib/primordials/globals'
import { MapCtor, SetCtor } from '@socketsecurity/lib/primordials/map-set'
import { ObjectFreeze } from '@socketsecurity/lib/primordials/object'
import { RegExpPrototypeTest } from '@socketsecurity/lib/primordials/regexp'
import {
  StringPrototypeIncludes,
  StringPrototypeIndexOf,
  StringPrototypeReplace,
  StringPrototypeSlice,
  StringPrototypeSplit,
  StringPrototypeStartsWith,
  StringPrototypeToLowerCase,
} from '@socketsecurity/lib/primordials/string'
import { isSemverString } from './strings.mjs'

export {
  comparePrereleases,
  compareSemver,
  parseConstraint,
  parseSemver,
} from './vers-semver.mjs'
export type {
  SemverParts,
  VersComparator,
  VersConstraint,
  VersWildcard,
} from './vers-semver.mjs'

import { compareSemver, parseConstraint } from './vers-semver.mjs'
import type { VersConstraint } from './vers-semver.mjs'

// Schemes that use semver comparison
const SEMVER_SCHEMES: ReadonlySet<string> = ObjectFreeze(
  new SetCtor([
    'semver',
    'npm',
    'cargo',
    'golang',
    'hex',
    'pub',
    'cran',
    'gem',
    'swift',
  ]),
)

// ASCII whitespace anywhere in a VERS string is invalid per spec — tools
// shall error, not trim.
const WHITESPACE_PATTERN = /\s/

// Version content containing separator/comparator characters must arrive
// URL-quoted; after splitting, `%` marks a quoted version to decode.
const RANGE_COMPARATORS: ReadonlySet<string> = ObjectFreeze(
  new SetCtor(['<', '<=', '>', '>=']),
)

// Separator/comparator characters a serialized version must URL-quote.
// `encodeURIComponent` leaves `!` and `*` unencoded, so the exact spec set
// is quoted by hand.
const VERS_QUOTE_PATTERN = /[!*<=>|]/g
const VERS_QUOTE_MAP: ReadonlyMap<string, string> = ObjectFreeze(
  new MapCtor([
    ['!', '%21'],
    ['*', '%2A'],
    ['<', '%3C'],
    ['=', '%3D'],
    ['>', '%3E'],
    ['|', '%7C'],
  ]),
)

/**
 * URL-quote the separator/comparator characters of a version for canonical
 * VERS serialization.
 */
export function quoteVersVersion(version: string): string {
  return StringPrototypeReplace(
    version,
    VERS_QUOTE_PATTERN,
    ch => VERS_QUOTE_MAP.get(ch)!,
  )
}

/**
 * Enforce the VERS canonical-form rules (spec: "Normalized, canonical
 * representation and validation") — a VERS string must arrive already
 * canonical; tools error instead of normalizing:
 *
 * 1. Versions are unique across all constraints, regardless of comparator.
 * 2. Constraints are sorted by version (verifiable only for schemes with a
 *    comparator — the semver schemes here).
 * 3. Ignoring `!=` constraints, an `=` constraint may be followed only by `=`,
 *    `>`, or `>=`.
 * 4. Ignoring `=` and `!=` constraints, the remaining comparators alternate: a
 *    lower bound (`>`/`>=`) is followed by an upper bound (`<`/`<=`) and vice
 *    versa.
 */
export function validateCanonicalConstraints(
  scheme: string,
  constraints: readonly VersConstraint[],
): void {
  const seenVersions = new SetCtor<string>()
  for (let i = 0, { length } = constraints; i < length; i += 1) {
    const c = constraints[i]!
    if (c.comparator === '*') {
      continue
    }
    if (seenVersions.has(c.version)) {
      throw new PurlError(
        `vers versions must be unique: "${c.version}" occurs more than once`,
      )
    }
    seenVersions.add(c.version)
  }
  if (SEMVER_SCHEMES.has(scheme)) {
    for (let i = 1, { length } = constraints; i < length; i += 1) {
      const prev = constraints[i - 1]!
      const c = constraints[i]!
      if (prev.comparator === '*' || c.comparator === '*') {
        continue
      }
      if (compareSemver(c.version, prev.version) < 0) {
        throw new PurlError(
          `vers constraints must be sorted by version: "${c.version}" ` +
            `follows "${prev.version}"`,
        )
      }
    }
  }
  let prevComparator: string | undefined
  for (let i = 0, { length } = constraints; i < length; i += 1) {
    const { comparator } = constraints[i]!
    if (comparator === '!=' || comparator === '*') {
      continue
    }
    if (
      prevComparator === '=' &&
      comparator !== '=' &&
      comparator !== '>' &&
      comparator !== '>='
    ) {
      throw new PurlError(
        `vers "=" constraint may only be followed by "=", ">", or ">=" — saw "${comparator}"`,
      )
    }
    prevComparator = comparator
  }
  let prevRange: string | undefined
  for (let i = 0, { length } = constraints; i < length; i += 1) {
    const { comparator } = constraints[i]!
    if (!RANGE_COMPARATORS.has(comparator)) {
      continue
    }
    const isLower = comparator === '>' || comparator === '>='
    if (prevRange !== undefined) {
      const prevIsLower = prevRange === '>' || prevRange === '>='
      if (prevIsLower === isLower) {
        throw new PurlError(
          `vers range comparators must alternate between lower and upper bounds: "${comparator}" follows "${prevRange}"`,
        )
      }
    }
    prevRange = comparator
  }
}

/**
 * VERS (VErsion Range Specifier) parser and evaluator.
 *
 * **Early adoption:** The VERS spec is pre-standard draft. This implementation
 * supports semver-based schemes (`npm`, `cargo`, `golang`, `gem`, etc.).
 * Additional version schemes may be added as the spec matures.
 *
 * @example
 *   ;```typescript
 *   const range = Vers.parse('vers:npm/>=1.0.0|<2.0.0')
 *   range.contains('1.5.0') // true
 *   range.contains('2.0.0') // false
 *   range.toString() // 'vers:npm/>=1.0.0|<2.0.0'
 *
 *   // Wildcard matches all versions
 *   Vers.parse('vers:semver/*').contains('999.0.0') // true
 *   ```
 */
export class Vers {
  readonly scheme: string
  readonly constraints: readonly VersConstraint[]

  private constructor(scheme: string, constraints: VersConstraint[]) {
    this.scheme = scheme
    this.constraints = ObjectFreeze(constraints)
    ObjectFreeze(this)
  }

  /**
   * Parse a VERS string.
   *
   * @param versStr - VERS string (e.g., `'vers:npm/>=1.0.0|<2.0.0'`)
   *
   * @returns `Vers` instance
   *
   * @throws {PurlError} If the string is not a valid VERS
   */
  static parse(versStr: string): Vers {
    return Vers.fromString(versStr)
  }

  /**
   * Parse a VERS string.
   *
   * @param versStr - VERS string (e.g., `'vers:npm/>=1.0.0|<2.0.0'`)
   *
   * @returns `Vers` instance
   *
   * @throws {PurlError} If the string is not a valid VERS
   */
  static fromString(versStr: string): Vers {
    if (typeof versStr !== 'string' || versStr.length === 0) {
      throw new PurlError('vers string is required')
    }

    // Must start with `'vers:'`
    if (!StringPrototypeStartsWith(versStr, 'vers:')) {
      throw new PurlError('vers string must start with "vers:" scheme')
    }

    // ASCII whitespace anywhere is invalid per spec — error, never trim.
    if (RegExpPrototypeTest(WHITESPACE_PATTERN, versStr)) {
      throw new PurlError('vers string must not contain whitespace')
    }

    const remainder = StringPrototypeSlice(versStr, 5) // after `'vers:'`
    const slashIndex = StringPrototypeIndexOf(remainder, '/')
    if (slashIndex === -1 || slashIndex === 0) {
      throw new PurlError(
        'vers string must contain a version scheme before "/"',
      )
    }

    const scheme = StringPrototypeToLowerCase(
      StringPrototypeSlice(remainder, 0, slashIndex),
    )
    const constraintsStr = StringPrototypeSlice(remainder, slashIndex + 1)

    if (constraintsStr.length === 0) {
      throw new PurlError('vers string must contain at least one constraint')
    }

    // Parse constraints
    const rawConstraints = StringPrototypeSplit(constraintsStr, '|')

    // Limit constraint count to prevent resource exhaustion
    const MAX_CONSTRAINTS = 1000
    if (rawConstraints.length > MAX_CONSTRAINTS) {
      throw new PurlError(
        `vers exceeds maximum of ${MAX_CONSTRAINTS} constraints`,
      )
    }

    const constraints: VersConstraint[] = []

    for (let i = 0, { length } = rawConstraints; i < length; i += 1) {
      const constraint = parseConstraint(rawConstraints[i]!)
      // A version carrying separator/comparator characters arrives
      // URL-quoted per spec; unquote it after the comparator split.
      if (
        constraint.comparator !== '*' &&
        StringPrototypeIncludes(constraint.version, '%')
      ) {
        ArrayPrototypePush(constraints, {
          ...constraint,
          version: GlobalDecodeUriComponent(constraint.version),
        })
        continue
      }
      ArrayPrototypePush(constraints, constraint)
    }

    // Validate: wildcard must be alone
    if (constraints.length > 1) {
      for (let i = 0, { length } = constraints; i < length; i += 1) {
        if (constraints[i]!.comparator === '*') {
          throw new PurlError('wildcard "*" must be the only constraint')
        }
      }
    }

    // Validate versions for semver schemes
    if (SEMVER_SCHEMES.has(scheme)) {
      for (let i = 0, { length } = constraints; i < length; i += 1) {
        const c = constraints[i]!
        if (c.comparator !== '*' && !isSemverString(c.version)) {
          throw new PurlError(
            `invalid semver version "${c.version}" in VERS constraint`,
          )
        }
      }
    }

    validateCanonicalConstraints(scheme, constraints)

    return new Vers(scheme, constraints)
  }

  /**
   * Check if a version is contained within this VERS range.
   *
   * Implements the VERS containment algorithm for semver-based schemes.
   *
   * @param version - Version string to check.
   *
   * @returns `true` if the version matches the range
   *
   * @throws {PurlError} If the scheme is not supported
   */
  contains(version: string): boolean {
    if (!SEMVER_SCHEMES.has(this.scheme)) {
      throw new PurlError(
        `unsupported VERS scheme "${this.scheme}" for containment check`,
      )
    }

    const { constraints } = this

    // Wildcard matches everything
    if (constraints.length === 1 && constraints[0]!.comparator === '*') {
      return true
    }

    // Check not-equals first — a `!=` exclusion takes priority over `=` inclusion
    // to prevent short-circuiting on `=` before a conflicting `!=` is evaluated.
    for (let i = 0, { length } = constraints; i < length; i += 1) {
      const c = constraints[i]!
      if (c.comparator === '!=' && compareSemver(version, c.version) === 0) {
        return false
      }
    }
    // Then check equals
    for (let i = 0, { length } = constraints; i < length; i += 1) {
      const c = constraints[i]!
      if (c.comparator === '=' && compareSemver(version, c.version) === 0) {
        return true
      }
    }

    // Filter to range constraints (not `=` or `!=`)
    const ranges: VersConstraint[] = []
    for (let i = 0, { length } = constraints; i < length; i += 1) {
      const c = constraints[i]!
      if (c.comparator !== '!=' && c.comparator !== '=') {
        ArrayPrototypePush(ranges, c)
      }
    }

    if (ranges.length === 0) {
      return false
    }

    // Evaluate range constraints
    // Per the VERS spec, constraints are sorted and form alternating intervals.
    // Multiple disjoint ranges are possible (e.g., `>=1.0.0|<2.0.0|>=3.0.0|<4.0.0`),
    // so we must check ALL range pairs — not return on the first mismatch.
    for (let i = 0, { length } = ranges; i < length; i += 1) {
      const c = ranges[i]!
      const cmp = compareSemver(version, c.version)

      if (c.comparator === '>=') {
        if (cmp < 0) {
          // Below this lower bound — skip to next range pair
          const next = ranges[i + 1]
          if (next && (next.comparator === '<' || next.comparator === '<=')) {
            i += 1
          }
          continue
        }
        // Version >= lower bound — check upper bound
        const next = ranges[i + 1]
        if (!next) {
          return true
        }
        const cmpNext = compareSemver(version, next.version)
        if (next.comparator === '<' && cmpNext < 0) {
          return true
        }
        if (next.comparator === '<=' && cmpNext <= 0) {
          return true
        }
        // Outside this range's upper bound — advance past it and try next range
        i += 1
      } else if (c.comparator === '>') {
        if (cmp <= 0) {
          // At or below this lower bound — skip to next range pair
          const next = ranges[i + 1]
          if (next && (next.comparator === '<' || next.comparator === '<=')) {
            i += 1
          }
          continue
        }
        // Version > lower bound — check upper bound
        const next = ranges[i + 1]
        if (!next) {
          return true
        }
        const cmpNext = compareSemver(version, next.version)
        if (next.comparator === '<' && cmpNext < 0) {
          return true
        }
        if (next.comparator === '<=' && cmpNext <= 0) {
          return true
        }
        // Outside this range's upper bound — advance past it and try next range
        i += 1
      } else {
        // Leading less-than without a preceding lower bound. `ranges` is
        // filtered to exactly the four bound comparators, and the two arms
        // above consumed '>' and '>=', so only '<' / '<=' reach here.
        const cmpVal = compareSemver(version, c.version)
        if (c.comparator === '<' && cmpVal < 0) {
          return true
        }
        if (c.comparator === '<=' && cmpVal <= 0) {
          return true
        }
        // Not in this range — continue to next
      }
    }
    return false
  }

  /**
   * Serialize to canonical VERS string.
   */
  toString(): string {
    const parts: string[] = []
    for (let i = 0, { length } = this.constraints; i < length; i += 1) {
      const c = this.constraints[i]!
      if (c.comparator === '*') {
        ArrayPrototypePush(parts, '*')
      } else if (c.comparator === '=') {
        ArrayPrototypePush(parts, quoteVersVersion(c.version))
      } else {
        ArrayPrototypePush(
          parts,
          `${c.comparator}${quoteVersVersion(c.version)}`,
        )
      }
    }
    return `vers:${this.scheme}/${ArrayPrototypeJoin(parts, '|')}`
  }
}
