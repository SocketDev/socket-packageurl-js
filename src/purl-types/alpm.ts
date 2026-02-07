/**
 * @fileoverview ALPM (Arch Linux Package Manager) PURL normalization.
 * https://github.com/package-url/purl-spec/blob/master/PURL-TYPES.rst#alpm
 */

import { lowerName, lowerNamespace } from '../strings.js'

interface PurlObject {
  name: string
  namespace?: string | undefined
  qualifiers?: Record<string, string> | undefined
  subpath?: string | undefined
  type?: string | undefined
  version?: string | undefined
}

/**
 * Normalize ALPM package URL.
 * Lowercases both namespace and name.
 */
export function normalize(purl: PurlObject): PurlObject {
  lowerNamespace(purl)
  lowerName(purl)
  return purl
}
