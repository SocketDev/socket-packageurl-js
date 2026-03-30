/**
 * @fileoverview GitLab PURL normalization and validation.
 * https://github.com/package-url/purl-spec/blob/master/PURL-TYPES.rst#other-candidate-types-to-define
 */

import { lowerName, lowerNamespace } from '../strings.js'
import { validateNoInjectionByType } from '../validate.js'

interface PurlObject {
  name: string
  namespace?: string | undefined
  qualifiers?: Record<string, string> | undefined
  subpath?: string | undefined
  type?: string | undefined
  version?: string | undefined
}

/**
 * Normalize GitLab package URL.
 * Lowercases both namespace and name.
 */
export function normalize(purl: PurlObject): PurlObject {
  lowerNamespace(purl)
  lowerName(purl)
  return purl
}

/**
 * Validate GitLab package URL.
 * Name and namespace must not contain injection characters.
 */
export function validate(purl: PurlObject, throws: boolean): boolean {
  if (
    !validateNoInjectionByType('gitlab', 'namespace', purl.namespace, throws)
  ) {
    return false
  }
  if (!validateNoInjectionByType('gitlab', 'name', purl.name, throws)) {
    return false
  }
  return true
}
