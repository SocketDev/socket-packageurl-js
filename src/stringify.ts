/**
 * @fileoverview PURL string serialization.
 * Converts PackageURL instances to canonical PURL string format.
 */

import {
  encodeComponent,
  encodeName,
  encodeNamespace,
  encodeQualifiers,
  encodeSubpath,
  encodeVersion,
} from './encode.js'
import { isNonEmptyString } from './strings.js'

import type { PackageURL } from './package-url.js'
import type { QualifiersObject } from './purl-component.js'

/**
 * Convert PackageURL instance to spec string (without scheme and type).
 *
 * Returns the package identity portion: namespace/name@version?qualifiers#subpath
 * This is the purl equivalent of an npm "spec" — the package identity without
 * the ecosystem prefix.
 *
 * @param purl - PackageURL instance to stringify
 * @returns Spec string (e.g., '%40babel/core@7.0.0' for pkg:npm/%40babel/core@7.0.0)
 *
 * @example
 * ```typescript
 * const purl = new PackageURL('npm', '@babel', 'core', '7.0.0')
 * stringifySpec(purl)
 * // -> '%40babel/core@7.0.0'
 * ```
 */
export function stringifySpec(purl: PackageURL): string {
  const {
    name,
    namespace,
    qualifiers,
    subpath,
    version,
  }: {
    name?: string | undefined
    namespace?: string | undefined
    qualifiers?: QualifiersObject | undefined
    subpath?: string | undefined
    version?: string | undefined
  } = purl
  let specStr = ''
  if (namespace) {
    specStr = `${encodeNamespace(namespace)}/`
  }
  specStr = `${specStr}${encodeName(name)}`
  if (version) {
    specStr = `${specStr}@${encodeVersion(version)}`
  }
  if (qualifiers) {
    specStr = `${specStr}?${encodeQualifiers(qualifiers)}`
  }
  if (subpath) {
    specStr = `${specStr}#${encodeSubpath(subpath)}`
  }
  return specStr
}

/**
 * Convert PackageURL instance to canonical PURL string.
 *
 * Serializes a PackageURL object into its canonical string representation
 * according to the PURL specification.
 *
 * @param purl - PackageURL instance to stringify
 * @returns Canonical PURL string (e.g., 'pkg:npm/lodash@4.17.21')
 *
 * @example
 * ```typescript
 * const purl = new PackageURL('npm', undefined, 'lodash', '4.17.21')
 * stringify(purl)
 * // -> 'pkg:npm/lodash@4.17.21'
 * ```
 */
export function stringify(purl: PackageURL): string {
  const type = isNonEmptyString(purl.type) ? encodeComponent(purl.type) : ''
  return `pkg:${type}/${stringifySpec(purl)}`
}
