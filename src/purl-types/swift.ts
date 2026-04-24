/**
 * @fileoverview Swift PURL validation.
 * https://github.com/package-url/purl-spec/blob/master/PURL-TYPES.rst#swift
 */

import {
  validateNoInjectionByType,
  validateRequiredByType,
} from '../validate.js'

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
 * Swift packages require both `namespace` and `version`. `name` and `namespace` must
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
    !validateNoInjectionByType('swift', 'namespace', purl.namespace, throws)
  ) {
    return false
  }
  if (!validateNoInjectionByType('swift', 'name', purl.name, throws)) {
    return false
  }
  return true
}
