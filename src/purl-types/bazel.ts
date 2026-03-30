/**
 * @fileoverview Bazel-specific PURL normalization and validation.
 * https://github.com/package-url/purl-spec/blob/master/PURL-TYPES.rst
 *
 * Bazel is a build system. Bazel packages represent external dependencies
 * in Bazel BUILD files.
 */

import { PurlError } from '../error.js'
import { lowerName } from '../strings.js'
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
 * Normalize Bazel package URL.
 * Lowercases name only.
 */
export function normalize(purl: PurlObject): PurlObject {
  lowerName(purl)
  return purl
}

/**
 * Validate Bazel package URL.
 * Bazel packages must have a version (for reproducible builds). Name must not
 * contain injection characters.
 */
export function validate(purl: PurlObject, throws: boolean): boolean {
  if (!purl.version || purl.version.length === 0) {
    if (throws) {
      throw new PurlError('bazel requires a "version" component')
    }
    return false
  }
  if (!validateNoInjectionByType('bazel', 'name', purl.name, throws)) {
    return false
  }
  return true
}
