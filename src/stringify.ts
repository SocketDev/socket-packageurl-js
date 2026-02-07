/**
 * @fileoverview PURL string serialization.
 * Converts PackageURL instances to canonical PURL string format.
 */

import { PurlComponent } from './purl-component.js'

import type { PackageURL } from './package-url.js'
import type { ComponentEncoder, QualifiersObject } from './purl-component.js'

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
  /* c8 ignore next - Type encoder uses default PurlComponentEncoder, never returns null/undefined. */ let purlStr = `pkg:${(PurlComponent['type']?.['encode'] as ComponentEncoder)?.(type) ?? ''}/`
  if (namespace) {
    /* c8 ignore next - Namespace encoder always returns string, never null/undefined. */ purlStr = `${purlStr}${(PurlComponent['namespace']?.['encode'] as ComponentEncoder)?.(namespace) ?? ''}/`
  }
  /* c8 ignore next - Name encoder always returns string, never null/undefined. */ purlStr = `${purlStr}${(PurlComponent['name']?.['encode'] as ComponentEncoder)?.(name) ?? ''}`
  if (version) {
    /* c8 ignore next - Version encoder always returns string, never null/undefined. */ purlStr = `${purlStr}@${(PurlComponent['version']?.['encode'] as ComponentEncoder)?.(version) ?? ''}`
  }
  if (qualifiers) {
    /* c8 ignore next - Qualifiers encoder always returns string, never null/undefined. */ purlStr = `${purlStr}?${(PurlComponent['qualifiers']?.['encode'] as ComponentEncoder)?.(qualifiers) ?? ''}`
  }
  if (subpath) {
    /* c8 ignore next - Subpath encoder always returns string, never null/undefined. */ purlStr = `${purlStr}#${(PurlComponent['subpath']?.['encode'] as ComponentEncoder)?.(subpath) ?? ''}`
  }
  return purlStr
}
