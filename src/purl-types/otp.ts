/**
 * @fileoverview OTP (Erlang/OTP) PURL normalization and validation.
 * https://github.com/package-url/purl-spec/blob/master/PURL-TYPES.rst
 *
 * OTP packages are Erlang/OTP libraries and applications.
 * Package names are typically lowercase.
 */

import { PurlError } from '../error.js'
import { containsInjectionCharacters, lowerName } from '../strings.js'
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
 * Normalize OTP package URL.
 * Lowercases name.
 */
export function normalize(purl: PurlObject): PurlObject {
  lowerName(purl)
  return purl
}

/**
 * Validate OTP package URL.
 * OTP packages must not have a namespace.
 */
export function validate(purl: PurlObject, throws: boolean): boolean {
  if (
    !validateEmptyByType('otp', 'namespace', purl.namespace, {
      throws,
    })
  ) {
    return false
  }
  if (containsInjectionCharacters(purl.name)) {
    if (throws) {
      throw new PurlError('otp "name" component contains illegal characters')
    }
    return false
  }
  return true
}
