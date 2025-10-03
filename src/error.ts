/**
 * @fileoverview Custom PurlError class for Package URL parsing and validation errors.
 * Provides consistent error message formatting for PURL-related exceptions.
 */

/**
 * Format error message for PURL exceptions.
 */
function formatPurlErrorMessage(message = ''): string {
  const { length } = message
  let formatted = ''
  if (length) {
    // Lower case start of message.
    const code0 = message.charCodeAt(0)
    formatted =
      code0 >= 65 /*'A'*/ && code0 <= 90 /*'Z'*/
        ? `${message[0]!.toLowerCase()}${message.slice(1)}`
        : message
    // Remove period from end of message.
    if (
      length > 1 &&
      message.charCodeAt(length - 1) === 46 /*'.'*/ &&
      message.charCodeAt(length - 2) !== 46
    ) {
      formatted = formatted.slice(0, -1)
    }
  }
  return `Invalid purl: ${formatted}`
}

/**
 * Custom error class for Package URL parsing and validation failures.
 */
class PurlError extends Error {
  constructor(message?: string | undefined, options?: ErrorOptions) {
    super(formatPurlErrorMessage(message), options)
  }
}

export { formatPurlErrorMessage, PurlError }
