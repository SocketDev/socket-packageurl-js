/**
 * @file PURL component handlers providing encoding, normalization, and
 *   validation functionality. Handles all Package URL components including
 *   `type`, `namespace`, `name`, `version`, `qualifiers`, and `subpath`.
 */
import {
  encodeComponent,
  encodeName,
  encodeNamespace,
  encodeQualifierParam,
  encodeQualifiers,
  encodeSubpath,
  encodeVersion,
} from './encode.mjs'
import { createHelpersNamespaceObject } from './helpers.mjs'
import {
  normalizeName,
  normalizeNamespace,
  normalizeQualifiers,
  normalizeSubpath,
  normalizeType,
  normalizeVersion,
} from './normalize.mjs'
import { isNonEmptyString } from './strings.mjs'
import {
  validateName,
  validateNamespace,
  validateQualifierKey,
  validateQualifiers,
  validateSubpath,
  validateType,
  validateVersion,
} from './validate.mjs'

/**
 * Type definitions for component handlers.
 */
export type ComponentEncoder = (_value: unknown) => string
export type ComponentNormalizer = (_value: string) => string | undefined
export type ComponentValidator = (_value: unknown, _throws: boolean) => boolean
export type QualifiersValue = string | number | boolean | null | undefined
export type QualifiersObject = Record<string, QualifiersValue>

const componentSortOrderLookup = {
  __proto__: null,
  type: 0,
  namespace: 1,
  name: 2,
  version: 3,
  qualifiers: 4,
  qualifierKey: 5,
  qualifierValue: 6,
  subpath: 7,
}

/**
 * Encode PURL component value to string.
 */
export function PurlComponentEncoder(comp: unknown): string {
  return isNonEmptyString(comp) ? encodeComponent(comp) : ''
}

/**
 * Normalize PURL component to string or undefined.
 */
export function PurlComponentStringNormalizer(
  comp: unknown,
): string | undefined {
  return typeof comp === 'string' ? comp : undefined
}

/**
 * Validate PURL component value.
 */
export function PurlComponentValidator(
  _comp: unknown,
  _throws: boolean,
): boolean {
  return true
}

/**
 * Compare two component names for sorting.
 */
export function componentComparator(compA: string, compB: string): number {
  return componentSortOrder(compA) - componentSortOrder(compB)
}

/**
 * Get numeric sort order for component name.
 */
export function componentSortOrder(comp: string): number {
  return (
    (componentSortOrderLookup as unknown as Record<string, number>)[comp] ??
    // Unknown components sort after all known ones
    8
  )
}

// Rules for each purl component:
// https://github.com/package-url/purl-spec/blob/main/PURL-SPECIFICATION.rst#rules-for-each-purl-component
const PurlComponent = createHelpersNamespaceObject(
  {
    encode: {
      name: encodeName,
      namespace: encodeNamespace,
      version: encodeVersion,
      qualifiers: encodeQualifiers,
      qualifierKey: encodeQualifierParam,
      qualifierValue: encodeQualifierParam,
      subpath: encodeSubpath,
    },
    normalize: {
      type: normalizeType,
      namespace: normalizeNamespace,
      name: normalizeName,
      version: normalizeVersion,
      qualifiers: normalizeQualifiers,
      subpath: normalizeSubpath,
    },
    validate: {
      type: validateType,
      namespace: validateNamespace,
      name: validateName,
      version: validateVersion,
      qualifierKey: validateQualifierKey,
      qualifiers: validateQualifiers,
      subpath: validateSubpath,
    },
  },
  {
    comparator: componentComparator,
    encode: PurlComponentEncoder,
    normalize: PurlComponentStringNormalizer,
    validate: PurlComponentValidator,
  },
)

export { PurlComponent }
