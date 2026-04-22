import {
  ObjectFreeze,
  StringPrototypeCharCodeAt,
  StringPrototypeSlice,
  StringPrototypeToLowerCase,
} from './primordials.js'

/**
 * @fileoverview Custom PurlError class for Package URL parsing and validation errors.
 * Provides consistent error message formatting for PURL-related exceptions.
 */

/**
 * Extract a readable message string from any thrown value.
 *
 * Returns `e.message` for Error instances, a coerced string for other
 * non-nullish values, and `'Unknown error'` for nullish or
 * empty-message cases. Use at boundaries where `catch (e: unknown)`
 * needs to surface a message (log lines, result payloads, API
 * responses) without a per-call-site type ladder.
 */
function errorMessage(e: unknown): string {
  if (e instanceof Error) {
    return e.message || 'Unknown error'
  }
  if (e === null || e === undefined) {
    return 'Unknown error'
  }
  return String(e) || 'Unknown error'
}

/**
 * Format error message for PURL exceptions.
 */
function formatPurlErrorMessage(message = ''): string {
  const { length } = message
  let formatted = ''
  if (length) {
    // Lower case start of message
    const code0 = StringPrototypeCharCodeAt(message, 0)
    formatted =
      code0 >= 65 /*'A'*/ && code0 <= 90 /*'Z'*/
        ? `${StringPrototypeToLowerCase(message[0]!)}${StringPrototypeSlice(message, 1)}`
        : message
    // Remove period from end of message
    if (
      length > 1 &&
      StringPrototypeCharCodeAt(message, length - 1) === 46 /*'.'*/ &&
      StringPrototypeCharCodeAt(message, length - 2) !== 46
    ) {
      formatted = StringPrototypeSlice(formatted, 0, -1)
    }
  }
  return `Invalid purl: ${formatted}`
}

/**
 * Custom error class for Package URL parsing and validation failures.
 */
class PurlError extends Error {
  constructor(
    message?: string | undefined,
    options?: ErrorOptions | undefined,
  ) {
    super(formatPurlErrorMessage(message), options)
  }
}

/**
 * Specialized error for injection character detection.
 * Developers can catch this specifically to distinguish injection rejections
 * from other PURL validation errors and handle them at an elevated level
 * (e.g., logging, alerting, blocking).
 *
 * Properties:
 * - `component` — which PURL component was rejected ("name", "namespace")
 * - `charCode` — the character code of the injection character found
 * - `purlType` — the package type (e.g., "npm", "maven")
 */
class PurlInjectionError extends PurlError {
  readonly charCode: number
  readonly component: string
  readonly purlType: string

  constructor(
    purlType: string,
    component: string,
    charCode: number,
    charLabel: string,
  ) {
    super(
      `${purlType} "${component}" component contains injection character ${charLabel}`,
    )
    this.charCode = charCode
    this.component = component
    this.purlType = purlType
    ObjectFreeze(this)
  }
}
ObjectFreeze(PurlInjectionError.prototype)

export { errorMessage, formatPurlErrorMessage, PurlError, PurlInjectionError }
