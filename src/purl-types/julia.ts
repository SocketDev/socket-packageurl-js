/**
 * @fileoverview Julia-specific PURL normalization and validation.
 * https://github.com/package-url/purl-spec/blob/master/PURL-TYPES.rst
 *
 * Julia packages are distributed through the Julia General registry.
 * Package names are case-sensitive and typically CamelCase.
 */

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
 * Normalize Julia package URL.
 * No normalization - Julia package names are case-sensitive.
 */
export function normalize(purl: PurlObject): PurlObject {
  return purl
}

/**
 * Validate Julia package URL.
 * Julia packages must not have a namespace.
 */
export function validate(purl: PurlObject, throws: boolean): boolean {
  if (
    !validateEmptyByType('julia', 'namespace', purl.namespace, {
      throws,
    })
  ) {
    return false
  }
  if (!validateNoInjectionByType('julia', 'name', purl.name, throws)) {
    return false
  }
  return true
}
