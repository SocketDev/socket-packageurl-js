/**
 * @fileoverview Unwrap a readable message string from a thrown value.
 *
 * Mirrors src/error.ts#errorMessage so scripts (which do not depend on
 * the compiled library) have the same helper. Keep the two in sync if
 * either changes.
 */

/**
 * Extract a readable message string from any thrown value.
 *
 * Returns `e.message` for Error instances, a coerced string for other
 * non-nullish values, and `'Unknown error'` for nullish or
 * empty-message cases. Use at boundaries where `catch (e: unknown)`
 * needs to surface a message (log lines, error payloads, summaries)
 * without a per-call-site type ladder.
 */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) {
    return e.message || 'Unknown error'
  }
  if (e === null || e === undefined) {
    return 'Unknown error'
  }
  return String(e) || 'Unknown error'
}
