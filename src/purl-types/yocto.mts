/**
 * @file Yocto-specific PURL normalization and validation.
 *   https://github.com/package-url/purl-spec/blob/main/PURL-TYPES.rst Yocto
 *   Project packages (recipes) for embedded Linux distributions. The namespace
 *   is the OPTIONAL layer name (BBFILE_COLLECTIONS in the layer's
 *   conf/layer.conf), e.g. `pkg:yocto/core/glibc@2.35`. The purl yocto type
 *   marks the namespace `case_sensitive: false`, so the canonical form
 *   lowercases it. The name (recipe PN/BPN) is `case_sensitive: true` — BitBake
 *   derives it verbatim from the `<name>_<version>.bb` filename, so it is
 *   preserved (lowercase is a dev-manual style convention, not enforced). The
 *   version (PV) is an opaque string and is preserved.
 */

import { lowerNamespace } from '../strings.mjs'
import { validateNoInjectionByType } from '../validate.mjs'

export interface PurlObject {
  name: string
  namespace?: string | undefined
  qualifiers?: Record<string, string> | undefined
  subpath?: string | undefined
  type?: string | undefined
  version?: string | undefined
}

/**
 * Normalize Yocto package URL. Lowercases the `namespace` (layer name, which is
 * case-insensitive); preserves `name` (recipe name, case-sensitive) and
 * `version`.
 */
export function normalize(purl: PurlObject): PurlObject {
  lowerNamespace(purl)
  return purl
}

/**
 * Validate Yocto package URL. `namespace` (optional layer name) and `name` must
 * not contain injection characters.
 */
export function validate(
  purl: PurlObject,
  options?: { throws?: boolean | undefined } | undefined,
): boolean {
  const { throws = false } = options ?? {}
  if (
    !validateNoInjectionByType('yocto', 'namespace', purl.namespace, { throws })
  ) {
    return false
  }
  if (!validateNoInjectionByType('yocto', 'name', purl.name, { throws })) {
    return false
  }
  return true
}
