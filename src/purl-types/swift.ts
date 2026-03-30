/**
 * @fileoverview Swift PURL validation.
 * https://github.com/package-url/purl-spec/blob/master/PURL-TYPES.rst#swift
 */

import { PurlError } from '../error.js'
import { containsInjectionCharacters } from '../strings.js'
import { validateRequiredByType } from '../validate.js'

interface PurlObject {
  name: string
  namespace?: string | undefined
  qualifiers?: Record<string, string> | undefined
  subpath?: string | undefined
  type?: string | undefined
  version?: string | undefined
}

/**
 * Validate Swift package URL.
 * Swift packages require both namespace and version. Name and namespace must
 * not contain injection characters.
 */
export function validate(purl: PurlObject, throws: boolean): boolean {
  if (
    !validateRequiredByType('swift', 'namespace', purl.namespace, {
      throws,
    })
  ) {
    return false
  }
  if (!validateRequiredByType('swift', 'version', purl.version, { throws })) {
    return false
  }
  if (
    typeof purl.namespace === 'string' &&
    containsInjectionCharacters(purl.namespace)
  ) {
    if (throws) {
      throw new PurlError(
        'swift "namespace" component contains illegal characters',
      )
    }
    return false
  }
  if (containsInjectionCharacters(purl.name)) {
    if (throws) {
      throw new PurlError('swift "name" component contains illegal characters')
    }
    return false
  }
  return true
}
