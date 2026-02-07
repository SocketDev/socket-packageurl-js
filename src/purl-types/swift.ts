/**
 * @fileoverview Swift PURL validation.
 * https://github.com/package-url/purl-spec/blob/master/PURL-TYPES.rst#swift
 */

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
 * Swift packages require both namespace and version.
 */
export function validate(purl: PurlObject, throws: boolean): boolean {
  return (
    validateRequiredByType('swift', 'namespace', purl.namespace, {
      throws,
    }) && validateRequiredByType('swift', 'version', purl.version, { throws })
  )
}
