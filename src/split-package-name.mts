/**
 * @file Split a raw ecosystem package name into its PURL `namespace` and `name`
 *   components per the package-url type rules
 *   (https://github.com/package-url/purl-spec/blob/main/PURL-TYPES.rst). A
 *   PURL's `namespace` means different things per type — an npm scope, a maven
 *   groupId, a composer vendor, an openvsx publisher — and the split point
 *   differs (first slash, last slash, colon-or-slash, scoped-only). Consumers
 *   that hand-roll this per-type table tend to forget a type (composer was a
 *   real instance), folding the namespace into the name and breaking lookups.
 *   This is the single spec-aware table they can call instead.
 */

import { ErrorCtor } from '@socketsecurity/lib/primordials/error'
import {
  StringPrototypeIncludes,
  StringPrototypeIndexOf,
  StringPrototypeLastIndexOf,
  StringPrototypeSlice,
  StringPrototypeStartsWith,
} from '@socketsecurity/lib/primordials/string'

import { normalizeType } from './normalize.mjs'

/**
 * The `namespace` + `name` a raw package name decomposes into. `namespace` is
 * `undefined` when the type is namespace-less or the name carries none.
 */
export type PurlPackageNameComponents = {
  namespace: string | undefined
  name: string
}

// Types whose namespace is the segment before the FIRST slash of a
// `namespace/name` package name (a single-segment namespace).
const FIRST_SLASH_TYPES = new Set([
  'composer',
  'openvsx',
  'vscode',
  'vscode-extension',
])

// Types whose namespace is everything before the LAST slash (a multi-segment
// namespace, e.g. a golang module path `github.com/user/repo`).
const LAST_SLASH_TYPES = new Set(['golang'])

export function splitOnFirstSlash(
  packageName: string,
): PurlPackageNameComponents {
  const slash = StringPrototypeIndexOf(packageName, '/')
  if (slash === -1) {
    return { name: packageName, namespace: undefined }
  }
  return {
    name: StringPrototypeSlice(packageName, slash + 1),
    namespace: StringPrototypeSlice(packageName, 0, slash),
  }
}

/**
 * Split `packageName` into `{ namespace, name }` per the PURL rules for `type`.
 *
 * - `composer`, `openvsx`, `vscode`(-extension): vendor/publisher before the
 *   first slash (`laravel/framework` → `laravel` + `framework`).
 * - `golang`: module path before the last slash (`github.com/user/repo` →
 *   `github.com/user` + `repo`).
 * - `maven`: groupId before a `:` or, failing that, the first `/`
 *   (`org.apache.commons:commons-lang3`).
 * - `npm`: only scoped names split (`@scope/name`); a bare name has no namespace.
 * - Any other type: the whole string is the `name`, no namespace.
 *
 * @param type - PURL type / ecosystem (case-insensitive, e.g. `'composer'`).
 * @param packageName - Raw package name (no version), e.g.
 *   `'laravel/framework'`.
 *
 * @returns The `{ namespace, name }` split.
 *
 * @throws {Error} If `type` or `packageName` is not a non-empty string.
 */
export function splitPurlPackageName(
  type: unknown,
  packageName: unknown,
): PurlPackageNameComponents {
  const normalizedType = normalizeType(type)
  if (!normalizedType) {
    throw new ErrorCtor('PURL type string is required.')
  }
  if (typeof packageName !== 'string' || packageName.length === 0) {
    throw new ErrorCtor('package name string is required.')
  }

  if (FIRST_SLASH_TYPES.has(normalizedType)) {
    return splitOnFirstSlash(packageName)
  }

  if (LAST_SLASH_TYPES.has(normalizedType)) {
    const slash = StringPrototypeLastIndexOf(packageName, '/')
    if (slash === -1) {
      return { name: packageName, namespace: undefined }
    }
    return {
      name: StringPrototypeSlice(packageName, slash + 1),
      namespace: StringPrototypeSlice(packageName, 0, slash),
    }
  }

  if (normalizedType === 'maven') {
    if (StringPrototypeIncludes(packageName, ':')) {
      const colon = StringPrototypeIndexOf(packageName, ':')
      return {
        name: StringPrototypeSlice(packageName, colon + 1),
        namespace: StringPrototypeSlice(packageName, 0, colon),
      }
    }
    return splitOnFirstSlash(packageName)
  }

  if (normalizedType === 'npm') {
    // Only scoped names carry a namespace; a bare name does not.
    if (
      StringPrototypeStartsWith(packageName, '@') &&
      StringPrototypeIncludes(packageName, '/')
    ) {
      return splitOnFirstSlash(packageName)
    }
    return { name: packageName, namespace: undefined }
  }

  return { name: packageName, namespace: undefined }
}
