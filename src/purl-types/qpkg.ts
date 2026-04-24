/**
 * @fileoverview QPKG (QNAP package) PURL normalization.
 * https://github.com/package-url/purl-spec/blob/master/PURL-TYPES.rst#qpkg
 */

import { lowerNamespace } from '../strings.js'

interface PurlObject {
  name: string
  namespace?: string | undefined
  qualifiers?: Record<string, string> | undefined
  subpath?: string | undefined
  type?: string | undefined
  version?: string | undefined
}

/**
 * Normalize QPKG package URL.
 * Lowercases `namespace` only.
 */
export function normalize(purl: PurlObject): PurlObject {
  lowerNamespace(purl)
  return purl
}
