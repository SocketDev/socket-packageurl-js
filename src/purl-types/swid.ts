/**
 * @fileoverview SWID (Software Identification Tag) PURL validation.
 * https://github.com/package-url/purl-spec/blob/master/types-doc/swid-definition.md
 */

import { PurlError } from '../error.js'
import {
  ObjectFreeze,
  RegExpPrototypeTest,
  StringPrototypeToLowerCase,
  StringPrototypeTrim,
} from '../primordials.js'
import { validateNoInjectionByType } from '../validate.js'

const GUID_PATTERN = ObjectFreeze(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
)

interface PurlObject {
  name: string
  namespace?: string | undefined
  qualifiers?: Record<string, string> | undefined
  subpath?: string | undefined
  type?: string | undefined
  version?: string | undefined
}

/**
 * Validate SWID package URL.
 * SWID requires a tag_id qualifier that must not be empty.
 * If tag_id is a GUID, it must be lowercase.
 */
export function validate(purl: PurlObject, throws: boolean): boolean {
  const { qualifiers } = purl
  // SWID requires a tag_id qualifier
  const tagId = qualifiers?.['tag_id']
  if (!tagId) {
    if (throws) {
      throw new PurlError('swid requires a "tag_id" qualifier')
    }
    return false
  }
  // tag_id must not be empty after trimming
  const tagIdStr = StringPrototypeTrim(String(tagId))
  if (tagIdStr.length === 0) {
    /* v8 ignore next 3 -- Throw path tested separately from return false path. */
    if (throws) {
      throw new PurlError('swid "tag_id" qualifier must not be empty')
    }
    return false
  }
  // If tag_id is a GUID, it must be lowercase
  if (RegExpPrototypeTest(GUID_PATTERN, tagIdStr)) {
    if (tagIdStr !== StringPrototypeToLowerCase(tagIdStr)) {
      if (throws) {
        throw new PurlError(
          'swid "tag_id" qualifier must be lowercase when it is a GUID',
        )
      }
      return false
    }
  }
  if (!validateNoInjectionByType('swid', 'name', purl.name, throws)) {
    return false
  }
  return true
}
