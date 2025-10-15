/**
 * @fileoverview Test helper utilities for creating test functions and data
 */

import { PackageURL } from '../../src/package-url.js'

/**
 * Create a test function with optional return value.
 * @param returnValue - Optional value to return from the function
 */
export function createTestFunction(returnValue?: string): () => string | void {
  if (returnValue !== undefined) {
    return function () {
      return returnValue
    }
  }
  return function () {}
}

/**
 * Create a PackageURL with simplified parameters.
 * @param type - Package type
 * @param name - Package name
 * @param opts - Optional parameters
 */
export function createTestPurl(
  type: string,
  name: string,
  opts?: {
    namespace?: string | null
    qualifiers?: Record<string, string> | null
    subpath?: string
    version?: string
  },
): PackageURL {
  return new PackageURL(
    type,
    opts?.namespace,
    name,
    opts?.version,
    opts?.qualifiers,
    opts?.subpath,
  )
}
