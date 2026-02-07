/**
 * @fileoverview MLflow PURL normalization and validation.
 * https://github.com/package-url/purl-spec/blob/master/PURL-TYPES.rst#mlflow
 */

import { lowerName } from '../strings.js'
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
 * Normalize MLflow package URL.
 * Lowercases name only if repository_url qualifier contains 'databricks'.
 */
export function normalize(purl: PurlObject): PurlObject {
  if (purl.qualifiers?.['repository_url']?.includes('databricks')) {
    lowerName(purl)
  }
  return purl
}

/**
 * Validate MLflow package URL.
 * MLflow packages must not have a namespace.
 */
export function validate(purl: PurlObject, throws: boolean): boolean {
  return validateEmptyByType('mlflow', 'namespace', purl.namespace, {
    throws,
  })
}
