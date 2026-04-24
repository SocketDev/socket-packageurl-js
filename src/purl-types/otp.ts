/**
 * @fileoverview OTP (Erlang/OTP) PURL normalization and validation.
 * https://github.com/package-url/purl-spec/blob/master/PURL-TYPES.rst
 *
 * OTP packages are Erlang/OTP libraries and applications.
 * Package names are typically lowercase.
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
 * Normalize OTP package URL.
 * Lowercases `name`.
 */
export function normalize(purl: PurlObject): PurlObject {
  lowerName(purl)
  return purl
}

/**
 * Validate OTP package URL.
 * OTP packages must not have a `namespace`.
 */
export function validate(purl: PurlObject, throws: boolean): boolean {
  if (
    !validateEmptyByType('otp', 'namespace', purl.namespace, {
      throws,
    })
  ) {
    return false
  }
  if (!validateNoInjectionByType('otp', 'name', purl.name, throws)) {
    return false
  }
  return true
}
