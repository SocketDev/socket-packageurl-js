/**
 * @fileoverview Bitnami PURL normalization.
 * https://github.com/package-url/purl-spec/blob/master/PURL-TYPES.rst#bitnami
 */

import { lowerName } from '../strings.js'

interface PurlObject {
  name: string
  namespace?: string | undefined
  qualifiers?: Record<string, string> | undefined
  subpath?: string | undefined
  type?: string | undefined
  version?: string | undefined
}

/**
 * Normalize Bitnami package URL.
 * Lowercases `name` only.
 */
export function normalize(purl: PurlObject): PurlObject {
  lowerName(purl)
  return purl
}
