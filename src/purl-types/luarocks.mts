/**
 * @file LuaRocks PURL normalization.
 *   https://github.com/package-url/purl-spec/blob/main/PURL-TYPES.rst#luarocks.
 *   Per the luarocks type definition, the namespace (author) and name (rock)
 *   are `case_sensitive: false` and normalized to ASCII lowercase — the
 *   luarocks client lowercases both (`name:lower()` / `namespace:lower()` in
 *   src/luarocks/util.lua) and rock/rockspec filenames are all-lowercase. The
 *   version is `case_sensitive: true`: the client never lowercases it and
 *   versions like `scm-1` / `cvs-1` are distinct identifiers ("lowercase must
 *   be used" is publisher guidance for old-client compatibility, not a
 *   canonicalizer fold), so it is preserved.
 */

import { lowerName, lowerNamespace } from '../strings.mjs'

export interface PurlObject {
  name: string
  namespace?: string | undefined
  qualifiers?: Record<string, string> | undefined
  subpath?: string | undefined
  type?: string | undefined
  version?: string | undefined
}

/**
 * Normalize LuaRocks package URL. Lowercases `namespace` (author) and `name`
 * (rock); preserves the case-sensitive `version`.
 */
export function normalize(purl: PurlObject): PurlObject {
  lowerNamespace(purl)
  lowerName(purl)
  return purl
}
