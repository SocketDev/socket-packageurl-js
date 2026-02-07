/**
 * @fileoverview Debian package PURL normalization.
 * https://github.com/package-url/purl-spec/blob/master/PURL-TYPES.rst#deb
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
 * Normalize Debian package URL.
 * Lowercases both namespace and name.
 */
export function normalize(purl: PurlObject): PurlObject {
  lowerNamespace(purl)
  lowerName(purl)
  return purl
}
