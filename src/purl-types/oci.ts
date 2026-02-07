/**
 * @fileoverview OCI (Open Container Initiative) PURL normalization and validation.
 * https://github.com/package-url/purl-spec/blob/master/PURL-TYPES.rst#oci
 */

import { lowerName } from '../strings.js'
import { validateEmptyByType } from '../validate.js'

interface PurlObject {
  name: string
  namespace?: string | undefined
  qualifiers?: Record<string, string> | undefined
  subpath?: string | undefined
  type?: string | undefined
  version?: string | undefined
}

/**
 * Normalize OCI package URL.
 * Lowercases name only.
 */
export function normalize(purl: PurlObject): PurlObject {
  lowerName(purl)
  return purl
}

/**
 * Validate OCI package URL.
 * OCI packages must not have a namespace.
 */
export function validate(purl: PurlObject, throws: boolean): boolean {
  return validateEmptyByType('oci', 'namespace', purl.namespace, {
    throws,
  })
}
