import {
  validateNoInjectionByType,
  validateRequiredByType,
} from '../validate.mjs'

import type { PurlObject } from '../purl-type.mjs'

export function gitValidate(
  purl: PurlObject,
  options?: { throws?: boolean | undefined } | undefined,
): boolean {
  const { throws = false } = options ?? {}
  return (
    validateRequiredByType('git', 'namespace', purl.namespace, { throws }) &&
    validateNoInjectionByType('git', 'namespace', purl.namespace, { throws }) &&
    validateNoInjectionByType('git', 'name', purl.name, { throws })
  )
}
