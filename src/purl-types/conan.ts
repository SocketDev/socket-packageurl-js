/**
 * @fileoverview Conan (C/C++) PURL validation.
 * https://github.com/package-url/purl-spec/blob/master/PURL-TYPES.rst#conan
 */

import { PurlError } from '../error.js'
import { isNullishOrEmptyString } from '../lang.js'

interface PurlObject {
  name: string
  namespace?: string | undefined
  qualifiers?: Record<string, string> | undefined
  subpath?: string | undefined
  type?: string | undefined
  version?: string | undefined
}

/**
 * Validate Conan package URL.
 * If namespace is present, qualifiers are required.
 * If channel qualifier is present, namespace is required.
 */
export function validate(purl: PurlObject, throws: boolean): boolean {
  if (isNullishOrEmptyString(purl.namespace)) {
    if (purl.qualifiers?.['channel']) {
      if (throws) {
        throw new PurlError(
          'conan requires a "namespace" component when a "channel" qualifier is present',
        )
      }
      return false
    }
  } else if (isNullishOrEmptyString(purl.qualifiers)) {
    if (throws) {
      throw new PurlError(
        'conan requires a "qualifiers" component when a namespace is present',
      )
    }
    return false
  }
  return true
}
