/**
 * @fileoverview Test utilities for package isolation testing.
 * Provides a simple helper to test the built package in the local dist directory.
 */

import path from 'node:path'

/**
 * Returns the path to the built package for testing.
 * This is a simplified version that just points to the local dist directory.
 *
 * @param {string} packagePath - Path to the package root directory.
 * @returns {Promise<{pkgPath: string}>}
 */
async function isolatePackage(packagePath) {
  // For this repo, we just test the built dist directory directly
  const pkgPath = path.resolve(packagePath)
  return { pkgPath }
}

export { isolatePackage }
