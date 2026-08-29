/*
 * @file Canonical fictional GitHub `owner/repo` placeholder for tests and
 *   docs — the owner/repo analog of `Acme Inc` for company names and the
 *   `acme-*` family for package names (docs/agents.md/fleet/
 *   public-surface-hygiene.md). `example.com`/`example.org` are IANA-reserved
 *   for documentation (RFC 2606), which is why `example-org` is the safer
 *   root than an invented name like `acme` — it can never collide with a
 *   real org that later registers it.
 *
 *   One canonical pair beats each test inventing its own (`acme/widgets`,
 *   `o/r`, `foo/bar`) — a shared literal greps as one thing fleet-wide
 *   instead of N near-duplicates, and a second/third repo in the same
 *   fixture gets a numbered sibling instead of a fresh throwaway name.
 *
 *   Adopting this retroactively across the existing test corpus is EXPLICIT
 *   deferred work, not silently dropped: the fixture-names-are-descriptive
 *   check + its burn-down list (scripts/fleet/constants/fixture-name-burn-
 *   down.json) is the precedent shape for a gradual, non-breaking sweep of
 *   this kind, should one get scheduled.
 */

// The canonical fictional owner. Never a real GitHub user or org.
export const EXAMPLE_OWNER = 'example-org'

// The canonical fictional repo under EXAMPLE_OWNER.
export const EXAMPLE_REPO = 'example-repo'

// `EXAMPLE_OWNER/EXAMPLE_REPO` — the single-repo case, most fixtures need
// nothing more than this.
export const EXAMPLE_OWNER_REPO = `${EXAMPLE_OWNER}/${EXAMPLE_REPO}`

/**
 * A numbered sibling repo under EXAMPLE_OWNER (`example-repo-two`,
 * `example-repo-three`, ...) for a fixture that needs to distinguish more
 * than one fictional repo. `n` is 1-indexed; `n === 1` returns the bare
 * EXAMPLE_REPO (no numbered suffix) so a single-repo caller can use this
 * helper uniformly instead of branching between it and the bare constant.
 */
export function exampleRepo(n: number): string {
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`exampleRepo: n must be a positive integer, got ${n}`)
  }
  const ORDINAL_WORDS = [
    'two',
    'three',
    'four',
    'five',
    'six',
    'seven',
    'eight',
    'nine',
    'ten',
  ]
  if (n === 1) {
    return EXAMPLE_REPO
  }
  const word = ORDINAL_WORDS[n - 2]
  if (word === undefined) {
    throw new Error(`exampleRepo: no ordinal word registered for n=${n}`)
  }
  return `${EXAMPLE_REPO}-${word}`
}

/**
 * `EXAMPLE_OWNER/exampleRepo(n)` — the fully-qualified numbered sibling.
 */
export function exampleOwnerRepo(n: number): string {
  return `${EXAMPLE_OWNER}/${exampleRepo(n)}`
}
