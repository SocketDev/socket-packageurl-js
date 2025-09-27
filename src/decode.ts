/**
 * @fileoverview URL decoding functionality for PURL components.
 * Provides proper error handling for invalid encoded strings.
 */
import { PurlError } from './error.js'

const { decodeURIComponent: decodeComponent } = globalThis

function decodePurlComponent(comp: string, encodedComponent: string): string {
  try {
    return decodeComponent(encodedComponent)
  } catch {
    /* c8 ignore next -- Intentionally empty, invalid encoding will throw below. */
  }
  throw new PurlError(`unable to decode "${comp}" component`)
}

export { decodePurlComponent }
