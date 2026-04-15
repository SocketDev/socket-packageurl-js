/**
 * @fileoverview VERS (VErsion Range Specifier) implementation.
 *
 * Implements the VERS specification for version range matching.
 * VERS is a companion standard to PURL, currently in pre-standard draft
 * with Ecma submission planned for late 2026.
 *
 * **Early adoption warning:** The VERS spec is not yet finalized. This
 * implementation covers the semver scheme and common aliases (npm, cargo,
 * golang, etc.). Additional version schemes may be added as the spec matures.
 *
 * @see https://github.com/package-url/vers-spec
 */

import { PurlError } from './error.js'
import {
  ArrayPrototypeJoin,
  ArrayPrototypePush,
  ObjectFreeze,
  RegExpPrototypeExec,
  RegExpPrototypeTest,
  SetCtor,
  StringPrototypeIndexOf,
  StringPrototypeSlice,
  StringPrototypeSplit,
  StringPrototypeStartsWith,
  StringPrototypeToLowerCase,
  StringPrototypeTrim,
} from './primordials.js'
import { isSemverString } from './strings.js'

/**
 * Valid VERS comparator operators.
 */
type VersComparator = '=' | '!=' | '<' | '<=' | '>' | '>='

/**
 * Special wildcard comparator matching all versions.
 */
type VersWildcard = '*'

/**
 * A single version constraint within a VERS range.
 */
type VersConstraint = {
  comparator: VersComparator | VersWildcard
  version: string
}

/**
 * Parsed semver components for comparison.
 */
type SemverParts = {
  major: number
  minor: number
  patch: number
  prerelease: string[]
}

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

// Valid comparator prefixes sorted by length (longest first for greedy matching)
const COMPARATORS: readonly string[] = ObjectFreeze([
  '!=',
  '<=',
  '>=',
  '<',
  '>',
  '=',
])

const DIGITS_ONLY = ObjectFreeze(/^\d+$/)

const regexSemverNumberedGroups = ObjectFreeze(
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/,
)

/**
 * Parse a semver string into comparable components.
 */
function parseSemver(version: string): SemverParts {
  const match = RegExpPrototypeExec(regexSemverNumberedGroups, version)
  if (!match) {
    throw new PurlError(`invalid semver version "${version}"`)
  }
  const major = Number(match[1])
  const minor = Number(match[2])
  const patch = Number(match[3])
  // Guard against precision loss with numbers above MAX_SAFE_INTEGER
  if (
    major > Number.MAX_SAFE_INTEGER ||
    minor > Number.MAX_SAFE_INTEGER ||
    patch > Number.MAX_SAFE_INTEGER
  ) {
    throw new PurlError(
      `version component exceeds maximum safe integer in "${version}"`,
    )
  }
  return {
    major,
    minor,
    patch,
    prerelease: match[4] ? StringPrototypeSplit(match[4], '.' as any) : [],
  }
}

/**
 * Compare two prerelease identifier arrays per semver spec.
 * Returns -1, 0, or 1.
 */
function comparePrereleases(a: string[], b: string[]): number {
  // No prerelease has higher precedence than any prerelease
  if (a.length === 0 && b.length === 0) {
    return 0
  }
  if (a.length === 0) {
    return 1
  }
  if (b.length === 0) {
    return -1
  }

  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i += 1) {
    const ai = a[i]!
    const bi = b[i]!
    if (ai === bi) {
      continue
    }
    const aNum = RegExpPrototypeTest(DIGITS_ONLY, ai)
    const bNum = RegExpPrototypeTest(DIGITS_ONLY, bi)
    // Numeric identifiers always have lower precedence than alphanumeric
    if (aNum && bNum) {
      const diff = Number(ai) - Number(bi)
      if (diff !== 0) {
        return diff < 0 ? -1 : 1
      }
    } else if (aNum) {
      return -1
    } else if (bNum) {
      return 1
    } else {
      // Alphanumeric: lexicographic comparison
      if (ai < bi) {
        return -1
      }
      if (ai > bi) {
        return 1
      }
    }
  }
  // Larger set of pre-release fields has higher precedence
  if (a.length !== b.length) {
    return a.length < b.length ? -1 : 1
  }
  return 0
}

/**
 * Compare two semver version strings.
 * Returns -1 if a < b, 0 if a === b, 1 if a > b.
 * Build metadata is ignored per semver spec.
 */
function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  // Compare major.minor.patch
  if (pa.major !== pb.major) {
    return pa.major < pb.major ? -1 : 1
  }
  if (pa.minor !== pb.minor) {
    return pa.minor < pb.minor ? -1 : 1
  }
  if (pa.patch !== pb.patch) {
    return pa.patch < pb.patch ? -1 : 1
  }
  // Compare prerelease
  const pre = comparePrereleases(pa.prerelease, pb.prerelease)
  if (pre !== 0) {
    return pre < 0 ? -1 : 1
  }
  return 0
}

/**
 * Parse a single constraint string into comparator and version.
 */
function parseConstraint(raw: string): VersConstraint {
  const trimmed = StringPrototypeTrim(raw)
  if (trimmed === '*') {
    return ObjectFreeze({
      __proto__: null,
      comparator: '*',
      version: '*',
    } as VersConstraint)
  }
  for (let i = 0, { length } = COMPARATORS; i < length; i += 1) {
    const op = COMPARATORS[i]!
    if (StringPrototypeStartsWith(trimmed, op)) {
      const version = StringPrototypeTrim(
        StringPrototypeSlice(trimmed, op.length),
      )
      if (version.length === 0) {
        throw new PurlError(`empty version after comparator "${op}"`)
      }
      return ObjectFreeze({
        __proto__: null,
        comparator: op as VersComparator,
        version,
      } as VersConstraint)
    }
  }
  // Bare version implies equality
  if (trimmed.length === 0) {
    throw new PurlError('empty constraint')
  }
  return ObjectFreeze({
    __proto__: null,
    comparator: '=',
    version: trimmed,
  } as VersConstraint)
}

/**
 * VERS (VErsion Range Specifier) parser and evaluator.
 *
 * **Early adoption:** The VERS spec is pre-standard draft. This implementation
 * supports semver-based schemes (npm, cargo, golang, gem, etc.). Additional
 * version schemes may be added as the spec matures.
 *
 * @example
 * ```typescript
 * const range = Vers.parse('vers:npm/>=1.0.0|<2.0.0')
 * range.contains('1.5.0')  // true
 * range.contains('2.0.0')  // false
 * range.toString()          // 'vers:npm/>=1.0.0|<2.0.0'
 *
 * // Wildcard matches all versions
 * Vers.parse('vers:semver/*').contains('999.0.0')  // true
 * ```
 */
class Vers {
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
   * @param versStr - VERS string (e.g., 'vers:npm/>=1.0.0|<2.0.0')
   * @returns Vers instance
   * @throws {PurlError} If the string is not a valid VERS
   */
  static parse(versStr: string): Vers {
    return Vers.fromString(versStr)
  }

  /**
   * Parse a VERS string.
   *
   * @param versStr - VERS string (e.g., 'vers:npm/>=1.0.0|<2.0.0')
   * @returns Vers instance
   * @throws {PurlError} If the string is not a valid VERS
   */
  static fromString(versStr: string): Vers {
    if (typeof versStr !== 'string' || versStr.length === 0) {
      throw new PurlError('VERS string is required')
    }

    // Must start with 'vers:'
    if (!StringPrototypeStartsWith(versStr, 'vers:')) {
      throw new PurlError('VERS must start with "vers:" scheme')
    }

    const remainder = StringPrototypeSlice(versStr, 5) // after 'vers:'
    const slashIndex = StringPrototypeIndexOf(remainder, '/')
    if (slashIndex === -1 || slashIndex === 0) {
      throw new PurlError('VERS must contain a version scheme before "/"')
    }

    const scheme = StringPrototypeToLowerCase(
      StringPrototypeSlice(remainder, 0, slashIndex),
    )
    const constraintsStr = StringPrototypeSlice(remainder, slashIndex + 1)

    if (constraintsStr.length === 0) {
      throw new PurlError('VERS must contain at least one constraint')
    }

    // Parse constraints
    const rawConstraints = StringPrototypeSplit(constraintsStr, '|' as any)

    // Limit constraint count to prevent resource exhaustion
    const MAX_CONSTRAINTS = 1000
    if (rawConstraints.length > MAX_CONSTRAINTS) {
      throw new PurlError(
        `VERS exceeds maximum of ${MAX_CONSTRAINTS} constraints`,
      )
    }

    const constraints: VersConstraint[] = []

    for (let i = 0, { length } = rawConstraints; i < length; i += 1) {
      const constraint = parseConstraint(rawConstraints[i]!)
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

    return new Vers(scheme, constraints)
  }

  /**
   * Check if a version is contained within this VERS range.
   *
   * Implements the VERS containment algorithm for semver-based schemes.
   *
   * @param version - Version string to check
   * @returns true if the version matches the range
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

    // Check not-equals first — a != exclusion takes priority over = inclusion
    // to prevent short-circuiting on = before a conflicting != is evaluated.
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

    // Filter to range constraints (not = or !=)
    const ranges: VersConstraint[] = []
    for (let i = 0, { length } = constraints; i < length; i += 1) {
      const c = constraints[i]!
      if (c.comparator !== '=' && c.comparator !== '!=') {
        ArrayPrototypePush(ranges, c)
      }
    }

    if (ranges.length === 0) {
      return false
    }

    // Evaluate range constraints
    // Per the VERS spec, constraints are sorted and form alternating intervals.
    // Multiple disjoint ranges are possible (e.g., >=1.0.0|<2.0.0|>=3.0.0|<4.0.0),
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
      } else if (c.comparator === '<' || c.comparator === '<=') {
        // Leading less-than without a preceding lower bound
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
        ArrayPrototypePush(parts, c.version)
      } else {
        ArrayPrototypePush(parts, `${c.comparator}${c.version}`)
      }
    }
    return `vers:${this.scheme}/${ArrayPrototypeJoin(parts, '|')}`
  }
}

export { Vers }

export type { VersComparator, VersConstraint, VersWildcard }
