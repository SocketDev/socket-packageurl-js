/**
 * @file Semver types and utilities used by the VERS range implementation.
 *   Provides parsing, comparison, and constraint parsing for semver-based
 *   VERS schemes.
 */
import { PurlError } from './error.mjs'
import { MathMin } from '@socketsecurity/lib/primordials/math'
import { ObjectFreeze } from '@socketsecurity/lib/primordials/object'
import {
  RegExpPrototypeExec,
  RegExpPrototypeTest,
} from '@socketsecurity/lib/primordials/regexp'
import {
  StringPrototypeSlice,
  StringPrototypeSplit,
  StringPrototypeStartsWith,
  StringPrototypeTrim,
} from '@socketsecurity/lib/primordials/string'

/**
 * Valid VERS comparator operators.
 */
export type VersComparator = '=' | '!=' | '<' | '<=' | '>' | '>='

/**
 * Special wildcard comparator matching all versions.
 */
export type VersWildcard = '*'

/**
 * A single version constraint within a VERS range.
 */
export type VersConstraint = {
  comparator: VersComparator | VersWildcard
  version: string
}

/**
 * Parsed semver components for comparison.
 */
export type SemverParts = {
  major: number
  minor: number
  patch: number
  prerelease: string[]
}

// Valid comparator prefixes sorted by length (longest first for greedy matching)
export const COMPARATORS: readonly string[] = ObjectFreeze([
  '!=',
  '<=',
  '>=',
  '<',
  '>',
  '=',
])

const DIGITS_ONLY = ObjectFreeze(/^\d+$/)

// Official SemVer 2.0.0 grammar (semver.org). Capture groups, in order:
//   1-3: major.minor.patch — each is `0` or a non-zero-leading run of digits.
//   4: optional `-prerelease` — dot-separated identifiers, each numeric
//      (no leading zero) or alphanumeric/hyphen.
//   5: optional `+build` metadata — dot-separated alphanumeric/hyphen runs.
const regexSemverNumberedGroups = ObjectFreeze(
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/,
)

/**
 * Compare two prerelease identifier arrays per semver spec. Returns `-1`, `0`,
 * or `1`.
 */
export function comparePrereleases(a: string[], b: string[]): number {
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

  const len = MathMin(a.length, b.length)
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
 * Compare two semver version strings. Returns `-1` if `a < b`, `0` if `a ===
 * b`, `1` if `a > b`. Build metadata is ignored per semver spec.
 */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
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
export function parseConstraint(raw: string): VersConstraint {
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
    throw new PurlError(
      'vers constraint must not be empty (use "*" for the wildcard)',
    )
  }
  return ObjectFreeze({
    __proto__: null,
    comparator: '=',
    version: trimmed,
  } as VersConstraint)
}

/**
 * Parse a semver string into comparable components.
 */
export function parseSemver(version: string): SemverParts {
  const match = RegExpPrototypeExec(regexSemverNumberedGroups, version)
  if (!match) {
    throw new PurlError(
      `semver version "${version}" must match MAJOR.MINOR.PATCH (e.g. "1.2.3")`,
    )
  }
  const major = Number(match[1])
  const minor = Number(match[2])
  const patch = Number(match[3])
  // Guard against precision loss with numbers above `MAX_SAFE_INTEGER`
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
    prerelease: match[4] ? StringPrototypeSplit(match[4], '.') : [],
  }
}
