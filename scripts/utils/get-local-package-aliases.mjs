/**
 * @fileoverview Shared helper for resolving local Socket package aliases.
 * Used by both esbuild and vitest configurations.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'

/**
 * Get aliases for local Socket packages when available.
 * Falls back to published versions in CI or when packages don't exist.
 *
 * @param {string} rootDir - The root directory of the current project
 * @returns {Record<string, string>} Package aliases mapping
 */
export function getLocalPackageAliases(rootDir) {
  const aliases = {}

  // Check for ../socket-registry/registry/dist
  const registryPath = path.join(rootDir, '..', 'socket-registry', 'registry', 'dist')
  if (existsSync(path.join(registryPath, '../package.json'))) {
    aliases['@socketsecurity/registry'] = registryPath
  }

  // Check for ../socket-packageurl-js/dist
  const packageurlPath = path.join(rootDir, '..', 'socket-packageurl-js', 'dist')
  if (existsSync(path.join(packageurlPath, '../package.json'))) {
    aliases['@socketregistry/packageurl-js'] = packageurlPath
  }

  // Check for ../socket-sdk-js/dist
  const sdkPath = path.join(rootDir, '..', 'socket-sdk-js', 'dist')
  if (existsSync(path.join(sdkPath, '../package.json'))) {
    aliases['@socketsecurity/sdk'] = sdkPath
  }

  return aliases
}
