/**
 * @fileoverview URL decoding functionality for PURL components.
 * Provides proper error handling for invalid encoded strings.
 */
import { PurlError } from './error.js'
import { decodeComponent } from './primordials.js'

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
