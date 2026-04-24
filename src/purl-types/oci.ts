/**
 * @fileoverview OCI (Open Container Initiative) PURL normalization and validation.
 * https://github.com/package-url/purl-spec/blob/master/PURL-TYPES.rst#oci
 */

import { lowerName, lowerVersion } from '../strings.js'
import { validateEmptyByType, validateNoInjectionByType } from '../validate.js'

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
 * Lowercases `name` and `version` per spec.
 */
export function normalize(purl: PurlObject): PurlObject {
  lowerName(purl)
  lowerVersion(purl)
  return purl
}

/**
 * Validate OCI package URL.
 * OCI packages must not have a `namespace`.
 */
export function validate(purl: PurlObject, throws: boolean): boolean {
  if (
    !validateEmptyByType('oci', 'namespace', purl.namespace, {
      throws,
    })
  ) {
    return false
  }
  if (!validateNoInjectionByType('oci', 'name', purl.name, throws)) {
    return false
  }
  return true
}
