/*
 * @file A copying sort for hook code, holding the ONE waiver the pair of rules
 *   between them forces.
 *   Two rules disagree on every sort in this tree:
 *
 *   - `socket/no-runtime-features-below-engine-floor` forbids `toSorted`, which
 *     arrived in Node 20. Hook sources compile into the .cjs dispatch bundles
 *     and run on a contributor's AMBIENT node, down to 18.
 *   - `unicorn/no-array-sort` requires `toSorted`, because `sort` mutates.
 *     Neither is wrong. `installEsPolyfills()` runs at the top of both built
 *     bundles, so a BUNDLED hook does have `toSorted` — but an `install.mts`
 *     entry marked `@dispatch-snapshot-exclude` is never bundled, runs as plain
 *     ESM on ambient node, and would throw on it. The floor is the honest
 *     constraint for shared code that either side may import. So the
 *     copy-then-sort stays, and the waiver lives here once instead of in every
 *     caller. Every hook sort routes through this file, because each separate
 *     copy was one more place to get the directive placement wrong, and a
 *     directive that has drifted off its statement waives nothing while still
 *     reading as protection. `es-polyfills.mts` keeps its own waiver: it
 *     IMPLEMENTS `toSorted`, so it cannot route through a helper that would
 *     call it.
 */

export type Comparator<T> = (a: T, b: T) => number

/**
 * `list` sorted by `compare`, leaving the input untouched.
 *
 * The extra `slice()` is deliberate: `[...list].sort(cmp)` is the exact shape
 * `unicorn/no-array-sort` autofixes back to `toSorted`, so the two rules would
 * take turns rewriting the line forever.
 */
export function sortedBy<T>(list: readonly T[], compare: Comparator<T>): T[] {
  // oxlint-disable-next-line unicorn/no-array-sort -- fresh copy
  return [...list].slice().sort(compare)
}

/**
 * Ascending comparator for strings, by code unit.
 *
 * Named rather than inlined at each call so a sort reads as sorted-by-what, and
 * so no caller reaches for `localeCompare`, whose order depends on the ambient
 * locale and would make a hook's output machine-dependent.
 */
export function byString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Descending comparator by string length, longest first.
 *
 * Longest-first is what a matcher wants when one candidate is a prefix of
 * another: it makes the longer name win instead of the shorter one claiming the
 * span first.
 */
export function byLengthDesc(a: string, b: string): number {
  return b.length - a.length
}

/**
 * `list` sorted ascending by code unit, leaving the input untouched.
 *
 * This is what a bare `.sort()` does to an array of strings, named so the call
 * site says which order it means.
 */
export function sortedStrings(list: readonly string[]): string[] {
  return sortedBy(list, byString)
}

/**
 * `list` sorted ascending by the string `key` returns.
 */
export function sortedByString<T>(
  list: readonly T[],
  key: (item: T) => string,
): T[] {
  return sortedBy(list, (a, b) => byString(key(a), key(b)))
}
