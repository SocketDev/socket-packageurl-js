/**
 * @file APK (Alpine Package Manager) PURL normalization.
 *   https://github.com/package-url/purl-spec/blob/main/PURL-TYPES.rst#apk.
 */

import { lowerName, lowerNamespace } from '../strings.mjs'

export interface PurlObject {
  name: string
  namespace?: string | undefined
  qualifiers?: Record<string, string> | undefined
  subpath?: string | undefined
  type?: string | undefined
  version?: string | undefined
}

/**
 * Normalize APK package URL. Lowercases both `namespace` and `name`.
 */
export function normalize(purl: PurlObject): PurlObject {
  lowerNamespace(purl)
  lowerName(purl)
  return purl
}
