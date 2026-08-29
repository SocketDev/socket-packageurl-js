// cargo installer (origin: 'cargo') — builds a crate from source via
// `cargo install <crate>@<version> --locked`, then verifies the binary is
// present and its `--version` output contains the pinned version.
//
// Used for crates that publish NO prebuilt binaries (no `cargo binstall`, no
// GitHub release assets) — e.g. crate-ci/cargo-fixit. There is no SRI to
// verify (no downloadable artifact); the `--locked` flag respects the
// published Cargo.lock, so the exact dependency closure IS the supply-chain
// control. The post-install `<binary> --version` check catches a silent
// install failure or a version drift.
//
// Lives in its own file because installers.mts is at the 500-line soft cap;
// every tool's install workflow lives in a sibling file (github-release.mts,
// skillspector.mts, …) and installers.mts keeps a thin wrapper so existing
// importers keep working unchanged.

import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { whichSync } from '@socketsecurity/lib-stable/bin/which'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import type { ToolEntry } from './tool-config.mts'

import { isCargoOrigin } from '../../../../../scripts/fleet/lib/external-tools-schema.mts'

const logger = getDefaultLogger()

export interface InstallCargoToolConfig {
  /**
   * Logical tool name (used for log banner).
   */
  readonly name: string
  /**
   * Human-readable display name for log output.
   */
  readonly displayName: string
  /**
   * Tool config entry from external-tools.json (must carry `crate`, `version`,
   * and `binary`).
   */
  readonly tool: ToolEntry
}

/**
 * Probe a binary on PATH: run `<binary> --version` and return true when the
 * output contains the pinned version. Exported so the test suite can mock the
 * spawn layer without touching the real filesystem.
 */
export async function checkCargoToolVersion(
  binary: string,
  version: string,
): Promise<boolean> {
  try {
    const result = await spawn(binary, ['--version'], { stdio: 'pipe' })
    const output = String(result.stdout).trim()
    return output.includes(version)
  } catch {
    return false
  }
}

/**
 * Install a cargo crate from source. Runs `cargo install <crate>@<version>
 * --locked`, then verifies the binary is present and its `--version` output
 * contains the pinned version. Fails loud on install failure or version
 * mismatch — never silently claims the tool is installed.
 *
 * Idempotent: when the binary is already on PATH at the pinned version, the
 * install is skipped entirely.
 */
export async function runSetupCargoInstallTool(
  // Required config param name matches the module-level tool-manifest `config`
  // by convention.
  // oxlint-disable-next-line no-shadow -- required config param name matches
  config: InstallCargoToolConfig,
): Promise<boolean> {
  const cfg = { __proto__: null, ...config } as InstallCargoToolConfig
  const { displayName, tool } = cfg
  if (!isCargoOrigin(tool)) {
    logger.error(`${displayName}: expected cargo origin in external-tools.json`)
    return false
  }
  const crate = tool.crate
  const version = tool.version
  const binary = tool.binary ?? cfg.name
  logger.log(`=== ${displayName} ===`)

  if (!crate) {
    logger.error(
      `${displayName}: missing \`crate\` in external-tools.json entry`,
    )
    return false
  }
  if (!version) {
    logger.error(
      `${displayName}: missing \`version\` in external-tools.json entry`,
    )
    return false
  }

  // Short-circuit: the binary is already on PATH at the pinned version. This
  // covers the common re-run case (the operator already ran `cargo install`
  // once) without paying the from-source compile again.
  const onPath = whichSync(binary, { nothrow: true })
  if (onPath && typeof onPath === 'string') {
    if (await checkCargoToolVersion(binary, version)) {
      logger.log(`Found on PATH at version ${version}: ${onPath}`)
      return true
    }
    logger.log(
      `Found on PATH but version differs — reinstalling ${crate}@${version}`,
    )
  }

  // `cargo` must be on PATH. The fleet's setup:rust step installs the
  // toolchain; we don't auto-bootstrap here (same pattern as skillspector
  // requiring uv on PATH).
  const cargoBin = whichSync('cargo', { nothrow: true })
  if (!cargoBin || typeof cargoBin !== 'string') {
    logger.error(
      'cargo not on PATH. Install the Rust toolchain first (rustup), then re-run.',
    )
    return false
  }

  logger.log(
    `Installing ${crate}@${version} from source (cargo install --locked)…`,
  )
  try {
    await spawn(
      cargoBin,
      ['install', `${crate}@${version}`, '--locked', '--force'],
      { stdio: 'pipe' },
    )
  } catch (e) {
    logger.error(
      `cargo install ${crate}@${version} --locked failed: ${errorMessage(e)}`,
    )
    return false
  }

  // Verify the binary is now present and its version matches the pin. The
  // `--force` flag above ensures a stale older version is overwritten, but
  // a failed build could still leave no binary behind — check explicitly.
  const installedBin = whichSync(binary, { nothrow: true })
  if (!installedBin || typeof installedBin !== 'string') {
    logger.error(`cargo install succeeded but \`${binary}\` is not on PATH.`)
    return false
  }
  if (!(await checkCargoToolVersion(binary, version))) {
    logger.error(
      `${displayName}: installed but \`--version\` does not contain ${version}.`,
    )
    logger.error(
      '  The pin and the installed binary disagree — refusing to claim ready.',
    )
    return false
  }

  logger.log(`Installed: ${installedBin} (${version})`)
  return true
}

// Ensure `process` is referenced so the import is not tree-shaken in bundles
// that only use the exported functions (some bundlers drop side-effect-free
// imports otherwise). No runtime cost — this is a no-op reference.
void process
