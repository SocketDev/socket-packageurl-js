/**
 * @file Hugging Face PURL normalization.
 *   https://github.com/package-url/purl-spec/blob/main/PURL-TYPES.rst#huggingface.
 */

import { RegExpPrototypeTest } from '@socketsecurity/lib/primordials/regexp'

import { PurlError } from '../error.mjs'
import { lowerVersion } from '../strings.mjs'
import { validateNoInjectionByType } from '../validate.mjs'

export interface PurlObject {
  name: string
  namespace?: string | undefined
  qualifiers?: Record<string, string> | undefined
  subpath?: string | undefined
  type?: string | undefined
  version?: string | undefined
}

export function huggingfaceValidate(
  purl: PurlObject,
  options?: { throws?: boolean | undefined } | undefined,
): boolean {
  const { throws = false } = options ?? {}
  const repositoryType = purl.qualifiers?.['type']
  if (
    repositoryType !== undefined &&
    repositoryType !== 'model' &&
    repositoryType !== 'dataset' &&
    repositoryType !== 'space'
  ) {
    if (throws) {
      throw new PurlError(
        'huggingface "type" qualifier must be model, dataset, or space',
      )
    }
    return false
  }
  return (
    validateNoInjectionByType('huggingface', 'namespace', purl.namespace, {
      throws,
    }) &&
    validateNoInjectionByType('huggingface', 'name', purl.name, { throws })
  )
}

export function normalize(purl: PurlObject): PurlObject {
  if (purl.version && RegExpPrototypeTest(/^[\da-fA-F]{40}$/, purl.version)) {
    lowerVersion(purl)
  }
  return purl
}
