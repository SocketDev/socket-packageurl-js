/**
 * @fileoverview Yocto-specific PURL normalization and validation.
 * https://github.com/package-url/purl-spec/blob/master/PURL-TYPES.rst
 *
 * Yocto Project packages (recipes) for embedded Linux distributions.
 * Package names are typically lowercase with hyphens.
 */

import { lowerName } from '../strings.js'
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
 * Normalize Yocto package URL.
 * Lowercases `name`.
 */
export function normalize(purl: PurlObject): PurlObject {
  lowerName(purl)
  return purl
}

/**
 * Validate Yocto package URL.
 * Yocto packages must not have a `namespace`.
 */
export function validate(purl: PurlObject, throws: boolean): boolean {
  if (
    !validateEmptyByType('yocto', 'namespace', purl.namespace, {
      throws,
    })
  ) {
    return false
  }
  if (!validateNoInjectionByType('yocto', 'name', purl.name, throws)) {
    return false
  }
  return true
}
