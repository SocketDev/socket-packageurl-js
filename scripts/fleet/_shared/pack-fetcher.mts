/**
 * @file Load the dep-0 seed's pack fetch, for fleet-tier callers that need the
 *   pack but must not reimplement reaching it. ONE loader, because two callers
 *   need it: the operator-facing `fetch-fleet-pack.mts` and the
 *   `member-fetcher-matches-pinned-pack` check. Both previously shelled their
 *   own `gh release download`, and a second implementation is precisely what
 *   let them keep calling a retired channel after the seed moved to GHCR.
 *   `session-fetch.mjs` states the same rule: nothing reimplements fetching, it
 *   loads or shells the fetcher. The seed pulls anonymously, which is why no
 *   token is needed: the pack package is public even though the repo that
 *   produces it is not.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Where the seed's tarball and manifest landed.
 */
export interface FetchedPack {
  manifest: string
  tarball: string
}

export type PackFetchFn = (config: {
  readonly ref: string
  readonly repo: string
  readonly tmp: string
}) => Promise<FetchedPack>

/**
 * The manifest fields the placement helpers read. Structural, so a caller's own
 * manifest interface satisfies it without importing the seed's type.
 */
export interface PlacementManifest {
  readonly files: Record<string, string>
  readonly movedPaths?: ReadonlyArray<{ from: string; to: string }> | undefined
  readonly removedPaths?: readonly string[] | undefined
}

export type PlacementFn = (dest: string, manifest: PlacementManifest) => number

/**
 * The seed's post-placement repair steps.
 *
 * `applyMovedPaths` completes a fleet move, relocating a file the pack no
 * longer ships at its old path. `removeTombstonedPaths` deletes what a past
 * pack shipped and a current one retired. Both are the seed's, not
 * reimplemented: a bundle refresh has to be a true convergence, and two copies
 * of a convergence rule is how they stop agreeing.
 */
export interface PackPlacement {
  applyMovedPaths: PlacementFn
  removeTombstonedPaths: PlacementFn
}

/**
 * The seed's path relative to a repo root. Committed in every member, beside
 * the fleet scripts rather than inside them.
 */
export const SEED_REL = path.join('scripts', 'repo', 'bootstrap', 'fleet.mjs')

/**
 * Load `fetchBundleSource` from the committed seed.
 *
 * The specifier is COMPUTED, not literal, and that is required rather than
 * stylistic: these callers live in the template tree where the seed has no
 * sibling, so a literal import would not resolve for the type checker even
 * though it resolves in every member, where `scripts/fleet/` and
 * `scripts/repo/bootstrap/` sit side by side.
 *
 * Fails loud with the path it looked at. A missing seed is a broken checkout,
 * and silently falling back to some other fetch is how two implementations
 * appeared in the first place.
 */
/**
 * Load the seed module, failing loud when it is absent.
 */
async function loadSeed(repoRoot: string): Promise<Record<string, unknown>> {
  const seed = path.join(repoRoot, SEED_REL)
  if (!existsSync(seed)) {
    throw new Error(
      'What: the dep-0 seed is missing.\n' +
        `Where: ${seed}\n` +
        'Saw: no committed seed at that path; wanted the one every member ships.\n' +
        `Fix: restore ${SEED_REL}. Fleet-tier callers delegate to it rather than carrying their own copies.`,
    )
  }
  return (await import(pathToFileURL(seed).href)) as Record<string, unknown>
}

/**
 * One named export from the seed, asserted to be callable.
 */
// `seed` here is the NOUN: the fetcher seed module loaded by loadSeed, not an
// act of setting anything up. setupFn would misname it.
// oxlint-disable-next-line socket/prefer-setup-phrasing -- the seed module's fn
function seedFn<T>(mod: Record<string, unknown>, name: string): T {
  const value = mod[name]
  if (typeof value !== 'function') {
    throw new Error(
      `What: the dep-0 seed exports no ${name}.\n` +
        `Where: ${SEED_REL}\n` +
        `Saw: ${typeof value}; wanted a function.\n` +
        'Fix: regenerate the seed with `pnpm run gen:bootstrap`.',
    )
  }
  return value as T
}

export async function loadPackFetcher(repoRoot: string): Promise<PackFetchFn> {
  // oxlint-disable-next-line socket/prefer-setup-phrasing -- seed noun
  return seedFn<PackFetchFn>(await loadSeed(repoRoot), 'fetchBundleSource')
}

/**
 * Load the seed's placement repair steps.
 */
export async function loadPackPlacement(
  repoRoot: string,
): Promise<PackPlacement> {
  const mod = await loadSeed(repoRoot)
  return {
    // oxlint-disable-next-line socket/prefer-setup-phrasing -- seed noun
    applyMovedPaths: seedFn<PlacementFn>(mod, 'applyMovedPaths'),
    // oxlint-disable-next-line socket/prefer-setup-phrasing -- seed noun
    removeTombstonedPaths: seedFn<PlacementFn>(mod, 'removeTombstonedPaths'),
  }
}
