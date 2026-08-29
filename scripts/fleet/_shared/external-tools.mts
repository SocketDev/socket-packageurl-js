/*
 * @file External tools manager — pinned, platform-specific tool binaries.
 *   Manages external CLI tools with:
 *
 *   - Pinned versions per tool
 *   - Platform-specific binaries (darwin-arm64, darwin-x64, linux-x64-musl,
 *     win32-x64)
 *   - SRI (sha512) verification on download
 *   - Local caching in ~/.socket/_tools/ Tools are defined in
 *     `.config/fleet/external-tools.json` and validated against the
 *     fleet-canonical `ToolEntry` schema
 *     (`scripts/fleet/lib/external-tools-schema.mts`) — the same schema every
 *     other tool-data file in the fleet uses (security-hook tools, CLI-bundled
 *     tools). There is no second, ad hoc shape here: `loadToolsConfig` parses
 *     through `parseToolsConfig`, so a data file that drifts from the schema
 *     fails at load time with a path-listed message instead of shipping
 *     unvalidated. Only the origins this file's consumers actually need are
 *     implemented: `gh-asset` (download a GitHub Release asset, verify its SRI
 *     integrity, extract, chmod) and `system` (operator/OS-installed — checked
 *     via PATH, never downloaded). Add another origin's install path only when
 *     a real tool needs it.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'
import { globSync } from '@socketsecurity/lib-stable/globs/match'
import { httpDownload } from '@socketsecurity/lib-stable/http-request/download'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  isGhAssetOrigin,
  isSystemOrigin,
  parseToolsConfig,
} from '../lib/external-tools-schema.mts'
import { REPO_ROOT } from '../paths.mts'
import { defaultCommandExists as commandExists } from '../setup/ecosystems.mts'

import type { GhAssetOriginType } from '../lib/external-tools-schema.mts'

// The 4 host platforms this file's installer resolves. Narrower than the
// schema's canonical 8 (which also covers glibc/arm64 variants other
// tool-data files need) — `pickPlatformEntry` below maps the two Linux
// hosts fleet CI actually runs (glibc + musl x64) onto whichever platforms
// entries a tool declares, so a musl-only static build still resolves on a
// glibc host.
export type Platform = 'darwin-arm64' | 'darwin-x64' | 'linux-x64' | 'win32-x64'

export interface ExternalToolsConfig {
  tools: Map<string, GhAssetOriginType | { origin: 'system'; version: string }>
}

const TOOLS_DIR = path.join(os.homedir(), '.socket', '_tools')

export function getCurrentPlatform(): Platform {
  const platform = process.platform
  const arch = process.arch

  if (platform === 'darwin' && arch === 'arm64') {
    return 'darwin-arm64'
  }
  if (platform === 'darwin' && arch === 'x64') {
    return 'darwin-x64'
  }
  if (platform === 'linux' && arch === 'x64') {
    return 'linux-x64'
  }
  if (platform === 'win32' && arch === 'x64') {
    return 'win32-x64'
  }

  throw new Error(`Unsupported platform: ${platform}-${arch}`)
}

// A musl static build runs on both musl and glibc x64 Linux, so a tool that
// only ships a `linux-x64-musl` entry still resolves on a glibc host. Prefer
// an exact `linux-x64` entry when a tool declares one.
export function pickPlatformEntry(
  platforms: GhAssetOriginType['platforms'],
  hostPlatform: Platform,
): { asset: string; integrity: string } | undefined {
  if (hostPlatform === 'linux-x64') {
    const entry = platforms['linux-x64'] ?? platforms['linux-x64-musl']
    return entry
      ? { asset: entry.asset, integrity: toSriString(entry.integrity) }
      : undefined
  }
  const entry = platforms[hostPlatform]
  return entry
    ? { asset: entry.asset, integrity: toSriString(entry.integrity) }
    : undefined
}

// `integrity` on a PlatformEntry is either a bare SRI string or the
// provenance object form (`{ value, src?, date? }`) — httpDownload wants the
// bare SRI string either way.
export function toSriString(
  integrity:
    | string
    | { value: string; src?: string | undefined; date?: string | undefined },
): string {
  return typeof integrity === 'string' ? integrity : integrity.value
}

export function loadToolsConfig(
  options?: { repoRoot?: string | undefined } | undefined,
): ExternalToolsConfig {
  const { repoRoot = REPO_ROOT } = {
    __proto__: null,
    ...options,
  } as NonNullable<typeof options>
  const configPath = path.join(
    repoRoot,
    '.config',
    'fleet',
    'external-tools.json',
  )
  if (!existsSync(configPath)) {
    return { tools: new Map() }
  }
  const raw: unknown = JSON.parse(readFileSync(configPath, 'utf8'))
  const parsed = parseToolsConfig(raw)
  const tools = new Map<
    string,
    GhAssetOriginType | { origin: 'system'; version: string }
  >()
  for (const [name, entry] of Object.entries(parsed.tools)) {
    if (isGhAssetOrigin(entry) || isSystemOrigin(entry)) {
      tools.set(name, entry)
    }
  }
  return { tools }
}

export function getToolDir(name: string, version: string): string {
  return path.join(TOOLS_DIR, name, version)
}

export function getToolBinPath(
  name: string,
  version: string,
  binName: string,
): string {
  return path.join(getToolDir(name, version), binName)
}

export function isToolInstalled(
  name: string,
  version: string,
  binName: string,
): boolean {
  const binPath = getToolBinPath(name, version, binName)
  return existsSync(binPath)
}

async function extractArchive(
  archivePath: string,
  destDir: string,
): Promise<void> {
  mkdirSync(destDir, { recursive: true })

  if (archivePath.endsWith('.tar.gz') || archivePath.endsWith('.tgz')) {
    await spawn('tar', ['-xzf', archivePath, '-C', destDir], {
      stdio: 'inherit',
    })
  } else if (archivePath.endsWith('.zip')) {
    if (process.platform === 'win32') {
      await spawn(
        'powershell',
        [
          '-Command',
          `Expand-Archive -Path '${archivePath}' -DestinationPath '${destDir}'`,
        ],
        { stdio: 'inherit' },
      )
    } else {
      await spawn('unzip', ['-o', archivePath, '-d', destDir], {
        stdio: 'inherit',
      })
    }
  } else {
    throw new Error(`Unknown archive format: ${archivePath}`)
  }
}

// A GitHub release tarball/zip doesn't always extract flat: oxipng (and most
// Rust/Go release archives) nest the binary inside a versioned directory
// (e.g. `oxipng-9.1.3-aarch64-apple-darwin/oxipng`), while other tools ship
// the binary at the archive root. Search the extracted tree for `binName`
// rather than assume either shape, then flatten it to the expected
// `getToolBinPath` location so every other consumer (isToolInstalled,
// listAvailableTools) can keep assuming one fixed path per tool+version.
export function flattenExtractedBinary(
  extractDir: string,
  binName: string,
  binPath: string,
): boolean {
  if (existsSync(binPath)) {
    return true
  }
  const matches = globSync(`**/${binName}`, { cwd: extractDir })
  if (matches.length === 0) {
    return false
  }
  const found = path.join(extractDir, matches[0]!)
  if (found === binPath) {
    return true
  }
  mkdirSync(path.dirname(binPath), { recursive: true })
  renameSync(found, binPath)
  return true
}

// `repository` is `github:<owner>/<repo>` (the fleet-wide convention every
// gh-asset entry uses); the release tag defaults to `v<version>`, `tag` when
// the project doesn't use a `v` prefix.
export function releaseAssetUrl(
  tool: GhAssetOriginType,
  asset: string,
): string {
  const repo = tool.repository.replace(/^github:/, '')
  const tag = tool.tag ?? `v${tool.version}`
  return `https://github.com/${repo}/releases/download/${tag}/${asset}`
}

async function installGhAssetTool(
  name: string,
  tool: GhAssetOriginType,
): Promise<{
  success: boolean
  binPath: string | undefined
  error?: string | undefined
}> {
  const platform = getCurrentPlatform()
  const platformEntry = pickPlatformEntry(tool.platforms, platform)
  if (!platformEntry) {
    return {
      success: false,
      binPath: undefined,
      error: `No binary for platform: ${platform}`,
    }
  }

  const version = tool.version ?? tool.tag!
  const toolDir = getToolDir(name, version)
  const binName = process.platform === 'win32' ? `${name}.exe` : name
  const binPath = getToolBinPath(name, version, binName)

  if (existsSync(binPath)) {
    return { success: true, binPath }
  }

  const archiveExt = platformEntry.asset.endsWith('.zip') ? '.zip' : '.tar.gz'
  const archivePath = path.join(toolDir, `archive${archiveExt}`)

  try {
    mkdirSync(toolDir, { recursive: true })
    await httpDownload(
      releaseAssetUrl(tool, platformEntry.asset),
      archivePath,
      { integrity: platformEntry.integrity },
    )

    await extractArchive(archivePath, toolDir)
    safeDeleteSync(archivePath)

    if (!flattenExtractedBinary(toolDir, binName, binPath)) {
      return {
        success: false,
        binPath: undefined,
        error: `Extracted ${platformEntry.asset} but found no "${binName}" inside it`,
      }
    }

    if (process.platform !== 'win32') {
      chmodSync(binPath, 0o755)
    }

    return { success: true, binPath }
  } catch (err) {
    return { success: false, binPath: undefined, error: String(err) }
  }
}

export async function installTool(
  name: string,
  tool: GhAssetOriginType | { origin: 'system'; version: string },
): Promise<{
  success: boolean
  binPath: string | undefined
  error?: string | undefined
}> {
  if (tool.origin === 'system') {
    if (commandExists(name)) {
      return { success: true, binPath: name }
    }
    return {
      success: false,
      binPath: undefined,
      error: `${name} is not installed — it has no fleet-managed download (OS package only)`,
    }
  }
  return installGhAssetTool(name, tool)
}

export async function ensureTool(name: string): Promise<{
  available: boolean
  binPath: string | undefined
  error?: string | undefined
}> {
  const config = loadToolsConfig()
  const tool = config.tools.get(name)

  if (!tool) {
    return {
      available: false,
      binPath: undefined,
      error: `Tool not configured: ${name}`,
    }
  }

  const result = await installTool(name, tool)
  return {
    available: result.success,
    binPath: result.binPath,
    error: result.error,
  }
}

export async function runTool(
  binPath: string,
  args: string[],
  options?:
    | { cwd?: string | undefined; stdio?: 'inherit' | 'pipe' | undefined }
    | undefined,
): Promise<{
  status: number
  stdout?: string | undefined
  stderr?: string | undefined
}> {
  const opts = { __proto__: null, ...options } as typeof options
  try {
    const result = await spawn(binPath, args, {
      cwd: opts?.cwd ?? REPO_ROOT,
      stdio: opts?.stdio ?? 'inherit',
    })
    return {
      status: result.code,
      stdout: result.stdout,
      stderr: result.stderr,
    }
  } catch (e) {
    const err = e as {
      code?: number | undefined
      stdout?: string | undefined
      stderr?: string | undefined
    }
    return {
      status: err.code ?? 1,
      stdout: err.stdout,
      stderr: err.stderr,
    }
  }
}

export function listAvailableTools(): Array<{
  name: string
  version: string
  installed: boolean
  platform: Platform
}> {
  const config = loadToolsConfig()
  const platform = getCurrentPlatform()
  const result: Array<{
    name: string
    version: string
    installed: boolean
    platform: Platform
  }> = []

  for (const [name, tool] of config.tools) {
    let installed = false

    if (tool.origin === 'system') {
      installed = commandExists(name)
    } else {
      const platformEntry = pickPlatformEntry(tool.platforms, platform)
      if (platformEntry) {
        const version = tool.version ?? tool.tag!
        const binName = process.platform === 'win32' ? `${name}.exe` : name
        installed = isToolInstalled(name, version, binName)
      }
    }

    result.push({
      name,
      version: tool.version ?? (tool.origin === 'gh-asset' ? tool.tag! : ''),
      installed,
      platform,
    })
  }

  return result
}
