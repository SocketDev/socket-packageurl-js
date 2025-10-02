/**
 * @fileoverview URL decoding functionality for PURL components.
 * Provides proper error handling for invalid encoded strings.
 */
import { PurlError } from './error.js'

// IMPORTANT: Do not use destructuring here - use direct assignment instead.
// tsgo has a bug that incorrectly transpiles destructured exports, resulting in
// `exports.decodeComponent = void 0;` which causes runtime errors.
// See: https://github.com/SocketDev/socket-packageurl-js/issues/3
const decodeComponent = globalThis.decodeURIComponent

/**
 * Decode PURL component value from URL encoding.
 * @throws {PurlError} When component cannot be decoded.
 */
function decodePurlComponent(comp: string, encodedComponent: string): string {
  try {
    return decodeComponent(encodedComponent)
  } catch (e) {
    throw new PurlError(`unable to decode "${comp}" component`, { cause: e })
  }
}

export { decodePurlComponent }
