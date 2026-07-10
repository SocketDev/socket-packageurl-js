/**
 * @file Bazel-specific PURL validation.
 *   https://github.com/package-url/purl-spec/blob/main/PURL-TYPES.rst Bazel is
 *   a build system. Bazel packages represent external dependencies in Bazel
 *   `BUILD` files. No normalize step: a Bazel module name is case-sensitive and
 *   already lowercase by Bazel's own grammar. Bazel validates module names
 *   against `VALID_MODULE_NAME = [a-z]([a-z0-9._-]*[a-z0-9])?`
 *   (RepositoryName.java in bazelbuild/bazel) and the Bazel Central Registry
 *   stores each module under that exact validated string, so uppercase is
 *   rejected at the source rather than folded — lowercasing here would only
 *   mask an invalid name. This matches the canonical purl-spec roundtrip
 *   fixture `pkg:bazel/Curl@8.8.0.bcr.1`, which preserves the input case. The
 *   purl bazel type definition carries no `case_sensitive` flag and no
 *   normalization rule, consistent with preserve.
 */

import { PurlError } from '../error.mjs'
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
 * Validate Bazel package URL. Bazel packages must have a `version` (for
 * reproducible builds). `name` must not contain injection characters.
 */
export function validate(
  purl: PurlObject,
  options?: { throws?: boolean | undefined } | undefined,
): boolean {
  const { throws = false } = options ?? {}
  if (!purl.version || purl.version.length === 0) {
    if (throws) {
      throw new PurlError('bazel requires a "version" component')
    }
    return false
  }
  if (!validateNoInjectionByType('bazel', 'name', purl.name, { throws })) {
    return false
  }
  return true
}
