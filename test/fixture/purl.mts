/**
 * @file Test helper utilities for creating test functions and data
 */

import { PackageURL } from '../../src/package-url.mjs'

/**
 * Create a test function with optional return value.
 *
 * @param returnValue - Optional value to return from the function.
 */
export function createTestFunction(
  returnValue?: string | undefined,
): () => string | undefined {
  if (returnValue !== undefined) {
    return () => returnValue
  }
  return () => undefined
}

/**
 * Create a PackageURL with simplified parameters.
 *
 * @param type - Package type.
 * @param name - Package name.
 * @param opts - Optional parameters.
 */
export function createTestPurl(
  type: string,
  name: string,
  opts?:
    | {
        namespace?: string | null | undefined
        qualifiers?: Record<string, string> | null | undefined
        subpath?: string | undefined
        version?: string | undefined
      }
    | undefined,
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
