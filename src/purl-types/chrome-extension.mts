/**
 * @file Chrome extension PURL normalization and validation.
 *   https://github.com/package-url/purl-spec/blob/main/types/chrome-extension-definition.json
 *   The name is a Chrome Web Store extension id: exactly 32 characters a-p
 *   rendered a-z in the spec's permitted pattern, case-insensitive (so
 *   normalize lowercases it). The version is semver-like with 1-4 numeric
 *   segments. A namespace is prohibited.
 */

import { PurlError } from '../error.mjs'
import { lowerName } from '../strings.mjs'
import { validateEmptyByType } from '../validate.mjs'

export interface PurlObject {
  name: string
  namespace?: string | undefined
  qualifiers?: Record<string, string> | undefined
  subpath?: string | undefined
  type?: string | undefined
  version?: string | undefined
}

// Spec `name_definition.permitted_characters`: a 32-char lowercase a-z
// extension id (checked after normalize lowercases the name).
const CHROME_EXTENSION_ID_PATTERN = /^[a-z]{32}$/

// Spec `version_definition.permitted_characters`: 1-4 dot-separated numeric
// segments, e.g. `1`, `0.6`, `6.0.2.3611`.
const CHROME_EXTENSION_VERSION_PATTERN = /^\d+(?:\.\d+){0,3}$/

/**
 * Normalize chrome-extension package URL. Lowercases `name` — the extension id
 * is case-insensitive per spec.
 */
export function normalize(purl: PurlObject): PurlObject {
  lowerName(purl)
  return purl
}

/**
 * Validate chrome-extension package URL. Chrome extensions must not have a
 * `namespace`; `name` must be a 32-char a-z extension id; `version`, when
 * present, must be 1-4 dot-separated numeric segments.
 */
export function validate(
  purl: PurlObject,
  options?: { throws?: boolean | undefined } | undefined,
): boolean {
  const { throws = false } = options ?? {}
  if (
    !validateEmptyByType('chrome-extension', 'namespace', purl.namespace, {
      throws,
    })
  ) {
    return false
  }
  if (!CHROME_EXTENSION_ID_PATTERN.test(purl.name)) {
    if (throws) {
      throw new PurlError(
        'chrome-extension "name" component must be a 32-character a-z extension id',
      )
    }
    return false
  }
  if (
    purl.version !== undefined &&
    !CHROME_EXTENSION_VERSION_PATTERN.test(purl.version)
  ) {
    if (throws) {
      throw new PurlError(
        'chrome-extension "version" component must be 1-4 dot-separated numeric segments',
      )
    }
    return false
  }
  return true
}
