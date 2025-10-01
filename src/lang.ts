/**
 * @fileoverview Language utility functions for checking null, undefined, and empty string values.
 * Provides type checking predicates for common value validation scenarios.
 */

/**
 * Check if a value is null, undefined, or an empty string.
 */
function isNullishOrEmptyString(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === 'string' && value.length === 0)
  )
}

export { isNullishOrEmptyString }
