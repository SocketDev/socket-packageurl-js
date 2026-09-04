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
  ['macos', 'darwin'],
  ['darwin', 'darwin'],
  ['linux', 'linux'],
])

// Formats that INSTALL a tool into a system location rather than carrying a
// binary you can extract and run in place. The fleet downloads an asset,
// verifies it against a recorded hash, and unpacks it - it never runs an
// installer, so pinning one of these records a hash for bytes nothing will
// ever use.
//
// A deny list rather than an allow list of archive suffixes, because plenty of
// releases ship a bare binary with no extension at all (`sfw-macos-arm64`), and
// requiring `.tar.gz` or `.zip` would drop every one of them.
const INSTALLER_SUFFIXES: readonly string[] = [
  '.apk',
  '.appimage',
  '.deb',
  '.dmg',
  '.exe',
  '.msi',
  '.pkg',
  '.rpm',
  '.snap',
]

/**
 * True when the asset installs rather than unpacks, so `--auto-platform` must
 * not map it.
 *
 * Without this, gh mapped `gh_2.99.0_linux_amd64.deb` to `linux-x64` and
 * `gh_2.99.0_windows_amd64.msi` to `win32-x64`. Both are real assets for real
 * platforms, so the entry validated and read as correct - the `.tar.gz` and
 * `.zip` beside them lost only because the release list is alphabetical and the
 * first asset per platform wins.
 */
export function isInstallerPackage(assetName: string): boolean {
  const lower = assetName.toLowerCase()
  return INSTALLER_SUFFIXES.some(suffix => lower.endsWith(suffix))
}

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
  // Case-folded once, then matched against lowercase tokens. gh names its
  // macOS assets `gh_2.99.0_macOS_arm64.zip`, and a case-sensitive scan found
  // no os token in that at all, so both Mac platforms were silently dropped
  // from the mapping rather than reported as unmappable.
  const lower = assetName.toLowerCase()
  // arch: iterate in insertion order — `aarch64` before `arm64` so the longer
  // token wins on `aarch64-apple-darwin` (it contains `arm64` as a substring
  // of `aarch64`, but `aarch64` is the real target).
  for (const [token, key] of ARCH_MAP) {
    if (lower.includes(token)) {
      arch = key
      break
    }
  }
  for (const [token, key] of OS_MAP) {
    if (lower.includes(token)) {
      os = key
      break
    }
  }
  if (arch === undefined || os === undefined) {
    return undefined
  }
  const libc = lower.includes('musl') ? '-musl' : ''
  return `${os}-${arch}${libc}` as CanonicalPlatformKeyType
}
