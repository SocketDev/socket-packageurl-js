/**
 * @fileoverview Bitbucket PURL normalization and validation.
 * https://github.com/package-url/purl-spec/blob/master/PURL-TYPES.rst#bitbucket
 */

import { PurlError } from '../error.js'
import {
  containsInjectionCharacters,
  lowerName,
  lowerNamespace,
} from '../strings.js'

interface PurlObject {
  name: string
  namespace?: string | undefined
  qualifiers?: Record<string, string> | undefined
  subpath?: string | undefined
  type?: string | undefined
  version?: string | undefined
}

/**
 * Normalize Bitbucket package URL.
 * Lowercases both namespace and name.
 */
export function normalize(purl: PurlObject): PurlObject {
  lowerNamespace(purl)
  lowerName(purl)
  return purl
}

/**
 * Validate Bitbucket package URL.
 * Name and namespace must not contain injection characters.
 */
export function validate(purl: PurlObject, throws: boolean): boolean {
  if (
    typeof purl.namespace === 'string' &&
    containsInjectionCharacters(purl.namespace)
  ) {
    if (throws) {
      throw new PurlError(
        'bitbucket "namespace" component contains illegal characters',
      )
    }
    return false
  }
  if (containsInjectionCharacters(purl.name)) {
    if (throws) {
      throw new PurlError(
        'bitbucket "name" component contains illegal characters',
      )
    }
    return false
  }
  return true
}
