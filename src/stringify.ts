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
  const {
    name,
    namespace,
    qualifiers,
    subpath,
    type,
    version,
  }: {
    name?: string | undefined
    namespace?: string | undefined
    qualifiers?: QualifiersObject | undefined
    subpath?: string | undefined
    type?: string | undefined
    version?: string | undefined
  } = purl
  let purlStr = `pkg:${isNonEmptyString(type) ? encodeComponent(type) : ''}/`
  if (namespace) {
    purlStr = `${purlStr}${encodeNamespace(namespace)}/`
  }
  purlStr = `${purlStr}${encodeName(name)}`
  if (version) {
    purlStr = `${purlStr}@${encodeVersion(version)}`
  }
  if (qualifiers) {
    purlStr = `${purlStr}?${encodeQualifiers(qualifiers)}`
  }
  if (subpath) {
    purlStr = `${purlStr}#${encodeSubpath(subpath)}`
  }
  return purlStr
}
