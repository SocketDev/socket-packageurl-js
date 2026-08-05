/**
 * @file Whether a purl's version slot names a version a registry could actually
 *   resolve.
 *   Deliberately separate from `validateVersion`. That one is a SAFETY gate —
 *   command-injection characters and a length cap — and a purl carrying
 *   `@^1.2.3` is perfectly valid per the purl spec, which treats the version as
 *   an opaque string. Folding resolvability into validation would start
 *   rejecting spec-valid purls.
 *   This is the separate question a resolver needs answered: can this string
 *   name one concrete published release? A range, a wildcard, a dist tag, or a
 *   dependency-specifier tail that leaked into the slot all parse fine and are
 *   all useless to look up. Callers decide what to do — reject the input, or
 *   resolve the range first and re-ask.
 *   Pure; no registry access.
 */

// A dependency-specifier tail that leaked into the version slot — whitespace or
// a `;`, as in a PEP 508 marker (`1.17.0 ; python_version >= "3.12"`) or a
// hyphenated range (`1.2.3 - 2.0.0`).
const REQUIREMENT_TAIL_RE = /[\s;]/

// A leading npm/Cargo range operator: `^1.2.3`, `~1.2`, `>=1.0.0`, `=1.0.0`.
const RANGE_OPERATOR_RE = /^[=^~<>]/

// A wildcard slot: a bare `*`, or a trailing `.x` / `.*` partial (`1.x`,
// `1.2.*`). Anchored to the final segment so a legitimate prerelease that
// merely contains an `x` (`1.0.0-alpha.x1`) is untouched.
const WILDCARD_RE = /^\*$|\.[*x]$/i

// A dist tag standing in for a version. Matched WHOLE — a prerelease that
// merely contains one of these words (`1.0.0-beta.1`) is a real version and
// must not be flagged.
const DIST_TAG_RE =
  /^(?:alpha|beta|canary|dev|edge|latest|next|nightly|rc|stable)$/i

/**
 * Why `version` cannot name a concrete release, or undefined when it can.
 *
 * The message names the specific pattern rather than listing every disallowed
 * shape, so a caller can tell the user what to fix instead of what the rule is.
 */
export function describeUnresolvableVersion(
  version: string,
): string | undefined {
  if (REQUIREMENT_TAIL_RE.test(version)) {
    return `version '${version}' contains whitespace or ';', which looks like a dependency-specifier tail (a PEP 508 marker, or a hyphenated range) leaking into the version slot — pass just the version`
  }
  if (RANGE_OPERATOR_RE.test(version)) {
    return `version '${version}' opens with a range operator, so it is an unresolved requirement rather than a release — pass the exact resolved version`
  }
  if (WILDCARD_RE.test(version)) {
    return `version '${version}' is a wildcard, which matches many releases and names none — pass the exact resolved version`
  }
  if (DIST_TAG_RE.test(version)) {
    return `version '${version}' is a dist tag, not a version; it moves over time and is not what was installed — pass the version the tag pointed at`
  }
  return undefined
}

/**
 * True when `version` could name one concrete published release.
 *
 * An empty string is unresolvable: a purl with no version names a package, not
 * a release, and a resolver asking about it has already lost what it needs.
 */
export function isResolvableVersion(version: string): boolean {
  return version !== '' && describeUnresolvableVersion(version) === undefined
}
