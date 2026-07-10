/**
 * @file URL decoding functionality for PURL components. Provides proper error
 *   handling for invalid encoded strings.
 */
import { PurlError } from './error.mjs'
import { decodeURIComponent as GlobalDecodeUriComponent } from '@socketsecurity/lib/primordials/globals'

// lib 6.0.3 dropped the `decodeComponent` alias from primordials/globals; it
// was just the global decodeURIComponent. Re-derive it from the
// canonically-named global.
const decodeComponent = GlobalDecodeUriComponent

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
