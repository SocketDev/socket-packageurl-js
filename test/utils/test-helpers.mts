/**
 * @fileoverview Test helper utilities for creating test functions and data
 */

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
