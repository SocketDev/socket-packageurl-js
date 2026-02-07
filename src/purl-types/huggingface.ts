/**
 * @fileoverview Hugging Face PURL normalization.
 * https://github.com/package-url/purl-spec/blob/master/PURL-TYPES.rst#huggingface
 */

import { lowerVersion } from '../strings.js'

interface PurlObject {
  name: string
  namespace?: string | undefined
  qualifiers?: Record<string, string> | undefined
  subpath?: string | undefined
  type?: string | undefined
  version?: string | undefined
}

/**
 * Normalize Hugging Face package URL.
 * Lowercases version only.
 */
export function normalize(purl: PurlObject): PurlObject {
  lowerVersion(purl)
  return purl
}
