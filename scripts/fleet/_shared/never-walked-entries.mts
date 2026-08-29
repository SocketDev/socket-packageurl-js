/**
 * @file Directory entries no canonical-tree walker descends into or records.
 *   ONE list for the walkers that MUST agree: the release producer
 *   (`release-bundle/collect-files.mts`), the cascade's tree hash
 *   (`sync-scaffolding/_shared/tree-hash.mts`), its layer resolver
 *   (`sync-scaffolding/template-layers.mts`), and the classification check
 *   (`check/wheelhouse-controlled-files-are-classified.mts`). If they disagree,
 *   the pack ships a file the cascade does not consider canonical, or hashes a
 *   tree the producer does not, and the two silently describe different content
 *   under one template SHA. Deliberately NOT shared with walkers that skip a
 *   different set on purpose: `lockstep/scan.mts` also skips `dist`,
 *   `check/copyleft-slices-are-tests-only` cares only about `.git`, and
 *   `check/tracked-files-are-within-size-cap` keeps its own broader list.
 *   Folding those in would change their behaviour, which is the opposite of the
 *   point. WHY JUNK MATTERS HERE and not only as tidiness: the pack is
 *   content-addressed by template SHA. A `.DS_Store` that exists on one
 *   builder's machine and not another's yields two different manifests for the
 *   SAME SHA, so the artifact stops being reproducible. macOS writes those
 *   files just from browsing a folder, and the wheelhouse is developed on
 *   macOS. The junk names are the OS and editor cruft classes; the curated
 *   bundler-oriented list from the `untracked` package is not used, because
 *   that package depends on `update-notifier`, which phones home and is one of
 *   the things FLEET_ENV exists to suppress. The data is worth having, the
 *   dependency is not.
 */

/**
 * Build, VCS, and runtime-state directories. Skipped for correctness, not size:
 * a per-hook `node_modules` holds `.bin` cmd-shims embedding the BUILDER's
 * absolute pnpm-store path, which are dead, non-hermetic files if shipped.
 *
 * `.cache` is the fleet's runtime-state store, gitignored at every depth, so a
 * hook writing its event log under a template dir is exactly the
 * varies-by-machine content this file exists to keep out of the hash.
 */
export const NEVER_WALKED_DIRS: readonly string[] = [
  '.cache',
  '.git',
  'node_modules',
]

/**
 * Machine-local cruft an OS or editor writes without being asked. Never
 * content, and its presence varies by who ran the build, which is what breaks a
 * content-addressed artifact.
 */
export const NEVER_WALKED_JUNK: readonly string[] = [
  '.DS_Store',
  '.AppleDouble',
  '.LSOverride',
  '.Spotlight-V100',
  '.Trashes',
  'Thumbs.db',
  'ehthumbs.db',
  'desktop.ini',
]

/**
 * Suffixes marking a machine-local temporary or backup file. Matched on the
 * whole entry name's ending, so `foo.mts.swp` and `foo.mts~` both qualify.
 */
export const NEVER_WALKED_SUFFIXES: readonly string[] = [
  '~',
  '.swp',
  '.swo',
  '.orig',
  '.rej',
]

/**
 * Whether a walker should skip this entry outright, directory or file.
 *
 * Name-based by design: these classes are identified by their name on every
 * platform, so no stat is needed and the answer cannot vary with the
 * filesystem.
 */
export function isNeverWalked(name: string): boolean {
  if (NEVER_WALKED_DIRS.includes(name) || NEVER_WALKED_JUNK.includes(name)) {
    return true
  }
  for (let i = 0, { length } = NEVER_WALKED_SUFFIXES; i < length; i += 1) {
    if (name.endsWith(NEVER_WALKED_SUFFIXES[i]!)) {
      return true
    }
  }
  return false
}
