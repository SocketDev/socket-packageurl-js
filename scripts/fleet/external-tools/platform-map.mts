/**
 * @file Map a GitHub release asset filename to a canonical platform key.
 *   `add --auto-platform` uses this to avoid hand-mapping every asset: given
 *   `communique-aarch64-apple-darwin.tar.gz` it returns `darwin-arm64`, given
 *   `zizmor-x86_64-unknown-linux-musl.tar.gz` it returns `linux-x64-musl`. The
 *   heuristic reads arch + os + libc tokens from the filename — the naming
 *   convention Rust's `cargo-dist` and most GitHub-release CLIs share. Pure,
 *   no I/O, unit-testable.
 */

import type { CanonicalPlatformKeyType } from '../lib/external-tools-schema.mts'

// arch: aarch64 and arm64 both mean ARM 64-bit; x86_64 and amd64 both mean
// x86-64. The key fragment each maps to in a canonical platform key.
const ARCH_MAP: ReadonlyMap<string, string> = new Map<string, string>([
  ['aarch64', 'arm64'],
  ['arm64', 'arm64'],
  ['x86_64', 'x64'],
  ['amd64', 'x64'],
])

// os: the Rust target triple's OS segment maps to the canonical platform's OS.
// Bare `darwin`/`linux` handle non-Rust naming (trufflehog-style
// `tool_1.0.0_darwin_amd64`); ordered AFTER the longer Rust tokens so
// `apple-darwin`/`unknown-linux` win on a real target triple.
const OS_MAP: ReadonlyMap<string, string> = new Map<string, string>([
  ['apple-darwin', 'darwin'],
  ['unknown-linux', 'linux'],
  ['pc-windows', 'win32'],
  ['windows', 'win32'],
  ['darwin', 'darwin'],
  ['linux', 'linux'],
])

/**
 * Map a GitHub release asset filename to a canonical platform key
 * (`darwin-arm64`, `linux-x64-musl`, …) or `undefined` when the filename
 * lacks a recognizable arch or os token.
 *
 * The heuristic scans for arch + os + libc substrings in order — the first
 * match in each category wins, which handles both `target-triple` names
 * (`aarch64-unknown-linux-gnu`) and looser names (`darwin-arm64.tar.gz`).
 * `musl` in the filename appends `-musl` to the platform key; glibc (the
 * default) does not.
 */
export function mapAssetToPlatform(
  assetName: string,
): CanonicalPlatformKeyType | undefined {
  let arch: string | undefined
  let os: string | undefined
  // arch: iterate in insertion order — `aarch64` before `arm64` so the longer
  // token wins on `aarch64-apple-darwin` (it contains `arm64` as a substring
  // of `aarch64`, but `aarch64` is the real target).
  for (const [token, key] of ARCH_MAP) {
    if (assetName.includes(token)) {
      arch = key
      break
    }
  }
  for (const [token, key] of OS_MAP) {
    if (assetName.includes(token)) {
      os = key
      break
    }
  }
  if (arch === undefined || os === undefined) {
    return undefined
  }
  const libc = assetName.includes('musl') ? '-musl' : ''
  return `${os}-${arch}${libc}` as CanonicalPlatformKeyType
}
