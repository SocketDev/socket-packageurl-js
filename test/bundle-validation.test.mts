/**
 * @fileoverview Bundle validation tests to ensure build output quality.
 * Verifies that dist files don't contain absolute paths or external dependencies.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packagePath = path.resolve(__dirname, '..')
const distPath = path.join(packagePath, 'dist')

/**
 * Check if content contains absolute paths.
 * Detects paths like /Users/, C:\, /home/, etc.
 */
function hasAbsolutePaths(content: string): {
  hasIssue: boolean
  matches: string[]
} {
  // Match absolute paths but exclude URLs and node: protocol.
  const patterns = [
    // Match require('/abs/path') or require('C:\\path').
    /require\(["'](?:\/[^"'\n]+|[A-Z]:\\[^"'\n]+)["']\)/g,
    // Match import from '/abs/path'.
    /import\s+.*?from\s+["'](?:\/[^"'\n]+|[A-Z]:\\[^"'\n]+)["']/g,
  ]

  const matches: string[] = []
  for (const pattern of patterns) {
    const found = content.match(pattern)
    if (found) {
      matches.push(...found)
    }
  }

  return {
    hasIssue: matches.length > 0,
    matches,
  }
}

/**
 * Check if content is missing external dependencies (they should be require() calls).
 * External dependencies should NOT be bundled inline.
 */
function checkExternalDependencies(content: string): {
  missingRequires: string[]
  hasAllRequires: boolean
} {
  // Dependencies that should be external (as require() calls).
  const externalDeps = ['@socketsecurity/lib']

  const missingRequires: string[] = []

  for (const dep of externalDeps) {
    // Check if the bundle has require() calls for this dependency.
    const requirePattern = new RegExp(
      `require\\(["']${dep.replace('/', '\\/')}["']\\)`,
    )
    const hasRequire = requirePattern.test(content)

    if (!hasRequire) {
      missingRequires.push(dep)
    }
  }

  return {
    missingRequires,
    hasAllRequires: missingRequires.length === 0,
  }
}

describe('Bundle validation', () => {
  it('should not contain absolute paths in dist/index.js', async () => {
    const indexPath = path.join(distPath, 'index.js')
    const content = await fs.readFile(indexPath, 'utf8')

    const result = hasAbsolutePaths(content)

    if (result.hasIssue) {
      console.error('Found absolute paths in bundle:')
      for (const match of result.matches) {
        console.error(`  - ${match}`)
      }
    }

    expect(result.hasIssue, 'Bundle should not contain absolute paths').toBe(
      false,
    )
  })

  it('should have external dependencies as require() calls', async () => {
    const indexPath = path.join(distPath, 'index.js')
    const content = await fs.readFile(indexPath, 'utf8')

    const result = checkExternalDependencies(content)

    if (!result.hasAllRequires) {
      console.error('Missing require() calls for external dependencies:')
      for (const dep of result.missingRequires) {
        console.error(`  - ${dep}`)
      }
    }

    expect(
      result.hasAllRequires,
      'All external dependencies should be require() calls, not bundled inline',
    ).toBe(true)
  })
})
