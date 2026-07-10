/**
 * @file Julia-specific PURL normalization and validation.
 *   https://github.com/package-url/purl-spec/blob/main/PURL-TYPES.rst Julia
 *   packages are distributed through the Julia General registry. Package names
 *   are case-sensitive and typically CamelCase.
 */

import { PurlError } from '../error.mjs'
import { validateEmptyByType, validateNoInjectionByType } from '../validate.mjs'

export interface PurlObject {
  name: string
  namespace?: string | undefined
  qualifiers?: Record<string, string> | undefined
  subpath?: string | undefined
  type?: string | undefined
  version?: string | undefined
}

/**
 * Normalize Julia package URL. No normalization - Julia package names are
 * case-sensitive.
 */
export function normalize(purl: PurlObject): PurlObject {
  return purl
}

/**
 * Validate Julia package URL. Julia packages must not have a `namespace` and
 * must carry the required `uuid` qualifier (package names are not unique
 * across Julia registries; the UUID is the identity).
 */
export function validate(
  purl: PurlObject,
  options?: { throws?: boolean | undefined } | undefined,
): boolean {
  const { throws = false } = options ?? {}
  if (
    !validateEmptyByType('julia', 'namespace', purl.namespace, {
      throws,
    })
  ) {
    return false
  }
  if (!purl.qualifiers?.['uuid']) {
    if (throws) {
      throw new PurlError('julia requires a "uuid" qualifier')
    }
    return false
  }
  if (!validateNoInjectionByType('julia', 'name', purl.name, { throws })) {
    return false
  }
  return true
}
