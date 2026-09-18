import { lowerName, lowerNamespace } from '../strings.mjs'

import type { PurlObject } from '../purl-type.mjs'

export function brewNormalize(purl: PurlObject): PurlObject {
  lowerNamespace(purl)
  lowerName(purl)
  return purl
}
