/**
 * @file RPM (Red Hat Package Manager) PURL normalization.
 *   https://github.com/package-url/purl-spec/blob/main/PURL-TYPES.rst#rpm.
 */

import { lowerNamespace } from '../strings.mjs'

export interface PurlObject {
  name: string
  namespace?: string | undefined
  qualifiers?: Record<string, string> | undefined
  subpath?: string | undefined
  type?: string | undefined
  version?: string | undefined
}

/**
 * Normalize RPM package URL. Lowercases `namespace` only.
 */
export function normalize(purl: PurlObject): PurlObject {
  lowerNamespace(purl)
  return purl
}
