/**
 * @file URL decoding functionality for PURL components. Provides proper error
 *   handling for invalid encoded strings.
 */
import { PurlError } from './error.mjs'
import { decodeComponent } from '@socketsecurity/lib/primordials/globals'

/**
 * Decode PURL component value from URL encoding.
 *
 * @throws {PurlError} When component cannot be decoded.
 */
export function decodePurlComponent(
  comp: string,
  encodedComponent: string,
): string {
  try {
    return decodeComponent(encodedComponent)
  } catch (e) {
    throw new PurlError(`unable to decode "${comp}" component`, { cause: e })
  }
}
