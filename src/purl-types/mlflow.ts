/**
 * @fileoverview MLflow PURL normalization and validation.
 * https://github.com/package-url/purl-spec/blob/master/PURL-TYPES.rst#mlflow
 */

import { StringPrototypeIncludes } from '../primordials.js'
import { lowerName } from '../strings.js'
import { validateEmptyByType, validateNoInjectionByType } from '../validate.js'

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
 * Lowercases `name` only if `repository_url` qualifier contains `'databricks'`.
 */
export function normalize(purl: PurlObject): PurlObject {
  const repoUrl = purl.qualifiers?.['repository_url']
  if (repoUrl !== undefined && StringPrototypeIncludes(repoUrl, 'databricks')) {
    lowerName(purl)
  }
  return purl
}

/**
 * Validate MLflow package URL.
 * MLflow packages must not have a `namespace`.
 */
export function validate(purl: PurlObject, throws: boolean): boolean {
  if (
    !validateEmptyByType('mlflow', 'namespace', purl.namespace, {
      throws,
    })
  ) {
    return false
  }
  if (!validateNoInjectionByType('mlflow', 'name', purl.name, throws)) {
    return false
  }
  return true
}
