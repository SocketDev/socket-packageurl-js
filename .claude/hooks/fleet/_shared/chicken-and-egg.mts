/**
 * @file Chicken-and-egg detection for guards. A guard that blocks the very file
 *   its own remediation requires is a bug, not a strict guard: the operator is
 *   told to do something the tool will not let them do, and the only ways out
 *   are a bypass phrase or routing around the hook. Both are worse than the
 *   guard standing down. Two shapes have actually happened.
 *   `no-new-config-guard` blocked authoring
 *   `template/presets/.config/repo/tsconfig.check.json`, a path the fleet's own
 *   file manifest declares and seeds - so the extension point was declared and
 *   unusable, and the guard blocked the repair. Separately, the oxlint
 *   rule-wiring check failed a commit because the live plugin index lacked a
 *   new rule, while only a cascade may write that mirror and the cascade needed
 *   the commit first. The common shape: the fleet itself governs the path, so a
 *   guard judging it by path shape alone has no standing. Ask
 *   `chickenAndEggStandDown` before blocking, and when it answers, log the
 *   reason and pass.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

// The generated ownership map: one entry per fleet-governed path, carrying who
// owns it, whether it is a cascade-locked mirror, and whether it seeds.
export const FLEET_MANIFEST_REL =
  'scripts/repo/sync-scaffolding/manifest/fleet-files.json'

// The canonical template trees. A body authored here is fleet source, and the
// manifest rather than a path-shape guard decides which of them exist.
const TEMPLATE_TREE_RE = /\/template\/(?:base|presets|overrides\/[^/]+)\//

export interface FleetFileEntry {
  readonly locked?: boolean | undefined
  readonly owner?: string | undefined
  readonly seedIfAbsent?: boolean | undefined
}

interface ManifestLookup {
  // A Map, not a record: the keys are repo-relative paths, an open set read off
  // disk, and every use here is a single lookup.
  readonly entries: ReadonlyMap<string, FleetFileEntry>
  readonly root: string
}

const manifestCache = new Map<string, ManifestLookup | undefined>()

/**
 * Whether the path sits in a canonical template tree.
 */
export function isTemplateAuthored(absPath: string): boolean {
  return TEMPLATE_TREE_RE.test(normalizePath(absPath))
}

/**
 * The nearest fleet file manifest at or above `fromPath`, with the repo root it
 * belongs to. Only the wheelhouse carries one, so a member gets undefined and
 * every manifest-based answer below is simply unavailable there.
 */
export function findFleetManifest(
  fromPath: string,
): ManifestLookup | undefined {
  let dir = path.dirname(path.resolve(fromPath))
  for (;;) {
    const cached = manifestCache.get(dir)
    if (cached !== undefined) {
      return cached
    }
    const candidate = path.join(dir, FLEET_MANIFEST_REL)
    if (existsSync(candidate)) {
      let found: ManifestLookup | undefined
      try {
        const parsed = JSON.parse(readFileSync(candidate, 'utf8')) as Record<
          string,
          unknown
        >
        // The map sits under `files` in the generated manifest; an older or
        // hand-written map is the document itself.
        const raw = (parsed['files'] ?? parsed) as Record<string, unknown>
        const entries = new Map<string, FleetFileEntry>()
        const keys = Object.keys(raw)
        for (let i = 0, { length } = keys; i < length; i += 1) {
          const key = keys[i]!
          entries.set(key, raw[key] as FleetFileEntry)
        }
        found = { entries, root: dir }
      } catch {
        found = undefined
      }
      manifestCache.set(dir, found)
      return found
    }
    const parent = path.dirname(dir)
    if (parent === dir) {
      return undefined
    }
    dir = parent
  }
}

/**
 * The manifest entry governing `absPath`, if the fleet declares it. Resolves
 * the path relative to the manifest's repo root, and strips a leading template
 * tree segment so `template/base/<rel>` finds the entry for `<rel>`.
 */
export function fleetDeclaredEntry(
  absPath: string,
): FleetFileEntry | undefined {
  const lookup = findFleetManifest(absPath)
  if (!lookup) {
    return undefined
  }
  const rel = normalizePath(path.relative(lookup.root, path.resolve(absPath)))
  const match = TEMPLATE_TREE_RE.exec(`/${rel}`)
  const declaredPath =
    match === null ? rel : rel.slice(match.index + match[0].length - 1)
  return lookup.entries.get(declaredPath)
}

/**
 * Why a guard should stand down on this path, or undefined when it may block.
 *
 * A path the fleet declares is governed by the manifest and its own checks, so
 * a guard judging it by shape has no standing. A locked mirror is worse: the
 * operator cannot legitimately write it at all, because only the cascade may,
 * so blocking strands them with no reachable fix.
 */
export function chickenAndEggStandDown(absPath: string): string | undefined {
  const entry = fleetDeclaredEntry(absPath)
  if (entry?.locked === true) {
    return 'the fleet manifest marks this a cascade-owned mirror, so only a cascade can write it'
  }
  if (entry?.seedIfAbsent === true) {
    return 'the fleet manifest seeds this path, so blocking its body leaves the extension point unusable'
  }
  if (entry !== undefined) {
    return 'the fleet manifest declares this path, so the manifest and its checks govern it'
  }
  if (isTemplateAuthored(absPath)) {
    return 'this is a body in a canonical template tree, where the file manifest decides what exists'
  }
  return undefined
}
