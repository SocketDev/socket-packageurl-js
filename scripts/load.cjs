'use strict'

/**
 * @fileoverview Unified script loader with alias support.
 *
 * Usage as wrapper:
 *   node scripts/load <script-name> [flags]
 *   node scripts/load build --clean
 */

const { spawn } = require('node:child_process')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

// When run directly, act as a wrapper script.
if (require.main === module) {
  const [, , scriptName, ...flags] = process.argv

  if (!scriptName) {
    console.error('Usage: node scripts/load <script-name> [flags]')
    console.error('Example: node scripts/load build --clean')
    process.exit(1)
  }

  // Add .mjs extension if not present.
  const scriptFile = scriptName.endsWith('.mjs')
    ? scriptName
    : `${scriptName}.mjs`
  const scriptPath = path.join(__dirname, scriptFile)

  // Run the script with the alias loader.
  // Convert loader path to file:// URL for cross-platform ESM loader support (Windows requires file:// URLs)
  const loaderPath = path.join(__dirname, 'utils', 'alias-loader.mjs')
  const args = [
    `--loader=${pathToFileURL(loaderPath).href}`,
    scriptPath,
    ...flags,
  ]

  const child = spawn(process.execPath, args, {
    stdio: 'inherit',
    cwd: process.cwd(),
  })

  child.on('exit', code => {
    process.exit(code ?? 0)
  })
}
