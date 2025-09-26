/**
 * @fileoverview PURL component handlers providing encoding, normalization, and validation functionality.
 * Handles all Package URL components including type, namespace, name, version, qualifiers, and subpath.
 */
import {
  encodeComponent,
  encodeName,
  encodeNamespace,
  encodeQualifierParam,
  encodeQualifiers,
  encodeSubpath,
  encodeVersion,
} from './encode.js'
import { createHelpersNamespaceObject } from './helpers.js'
import {
  normalizeName,
  normalizeNamespace,
  normalizeQualifiers,
  normalizeSubpath,
  normalizeType,
  normalizeVersion,
} from './normalize.js'
import { isNonEmptyString, localeCompare } from './strings.js'
import {
  validateName,
  validateNamespace,
  validateQualifierKey,
  validateQualifiers,
  validateSubpath,
  validateType,
  validateVersion,
} from './validate.js'

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

function componentSortOrder(comp: string): string | number {
  return (
    (componentSortOrderLookup as unknown as Record<string, number>)[comp] ??
    comp
  )
}

function componentComparator(compA: string, compB: string): number {
  return localeCompare(
    String(componentSortOrder(compA)),
    String(componentSortOrder(compB)),
  )
}

function PurlComponentEncoder(comp: unknown): string {
  return isNonEmptyString(comp) ? encodeComponent(comp) : ''
}

function PurlComponentStringNormalizer(comp: unknown): string | undefined {
  return typeof comp === 'string' ? comp : undefined
}

function PurlComponentValidator(_comp: unknown, _throws: boolean): boolean {
  return true
}

// Rules for each purl component:
// https://github.com/package-url/purl-spec/blob/master/PURL-SPECIFICATION.rst#rules-for-each-purl-component
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

export {
  PurlComponent,
  PurlComponentEncoder,
  PurlComponentStringNormalizer,
  PurlComponentValidator,
  componentComparator,
  componentSortOrder,
}
