/**
 * @fileoverview OPAM-specific PURL validation.
 * https://github.com/package-url/purl-spec/blob/master/PURL-TYPES.rst
 *
 * OPAM is the OCaml package manager. Package names are lowercase.
 */

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
 * Validate OPAM package URL.
 * OPAM packages must not have a namespace.
 */
export function validate(purl: PurlObject, throws: boolean): boolean {
  return validateEmptyByType('opam', 'namespace', purl.namespace, {
    throws,
  })
}
