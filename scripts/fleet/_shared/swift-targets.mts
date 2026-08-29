/**
 * @file Swift target discovery shared by the Swift runners (`fmt-swift.mts`,
 *   `lint-swift.mts`, `fix-swift.mts`). Walks a repo for first-party Swift
 *   targets — a directory holding an `*.xcodeproj`, an `*.xcworkspace`, or a
 *   `Package.swift` — skipping vendored/generated code and other sessions'
 *   agent worktrees, the same floor `cargo-workspaces.mts` applies to
 *   `Cargo.toml` and `go-workspaces.mts` applies to `go.mod`. A repo can carry
 *   more than one target (an Xcode app plus a standalone Swift package), so
 *   every directory that owns one of the three markers is kept, even when
 *   nested under another target's directory.
 */

import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

// Directories whose Swift is not ours to lint or format: vendored/upstream
// drops, package-manager/Xcode build output, and per-checkout caches. Mirrors
// go-workspaces.mts's SKIP_DIRS, plus `.build` (SwiftPM's build dir) and
// `DerivedData` (Xcode's build dir).
export const SKIP_DIRS: ReadonlySet<string> = new Set([
  '.build',
  '.git',
  'build',
  'coverage',
  'deps',
  'DerivedData',
  'external',
  // A fixtures dir is test corpus, never first-party Swift.
  'fixtures',
  'node_modules',
  'target',
  'third_party',
  'upstream',
  'vendor',
])

// Agent worktrees are full checkouts of this repo living inside it, so the
// walk would find their Swift targets and act on source another session is
// editing. Matched on the path rather than the directory name so a repo that
// legitimately owns a `worktrees/` directory keeps its Swift covered.
const WORKTREE_ROOT = '.claude/worktrees'

export function isAgentWorktreePath(dirPath: string): boolean {
  const p = normalizePath(dirPath)
  return p === WORKTREE_ROOT || p.endsWith(`/${WORKTREE_ROOT}`)
}

/**
 * Every directory at or under `repoRoot` that owns a Swift target marker (an
 * `*.xcodeproj`, an `*.xcworkspace`, or a `Package.swift`), skipping
 * vendored/build subtrees and agent worktrees. The walk never descends into a
 * matched `.xcodeproj`/`.xcworkspace` bundle itself — there is no Swift source
 * inside one worth discovering. Returns absolute, normalized (`/`-separated),
 * sorted paths. Missing/unreadable directories are skipped, never thrown.
 */
export function findSwiftTargetDirs(repoRoot: string): string[] {
  const dirs: string[] = []
  const stack = [repoRoot]
  while (stack.length) {
    const dir = stack.pop()!
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    let hasMarker = false
    for (let i = 0, { length } = entries; i < length; i += 1) {
      const name = entries[i]!
      if (
        name === 'Package.swift' ||
        name.endsWith('.xcodeproj') ||
        name.endsWith('.xcworkspace')
      ) {
        hasMarker = true
        continue
      }
      if (
        SKIP_DIRS.has(name) ||
        name.endsWith('-bundled') ||
        name.endsWith('-vendored')
      ) {
        continue
      }
      const abs = path.join(dir, name)
      let st
      try {
        st = statSync(abs)
      } catch {
        continue
      }
      if (st.isDirectory() && !isAgentWorktreePath(abs)) {
        stack.push(abs)
      }
    }
    if (hasMarker) {
      dirs.push(normalizePath(dir))
    }
  }
  return dirs.toSorted()
}
