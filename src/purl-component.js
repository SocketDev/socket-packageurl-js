'use strict'

const {
  encodeComponent,
  encodeName,
  encodeNamespace,
  encodeQualifierParam,
  encodeQualifiers,
  encodeSubpath,
  encodeVersion
} = require('./encode')
const { createHelpersNamespaceObject } = require('./helpers')
const {
  normalizeName,
  normalizeNamespace,
  normalizeQualifiers,
  normalizeSubpath,
  normalizeType,
  normalizeVersion
} = require('./normalize')
const { isNonEmptyString, localeCompare } = require('./strings')
const {
  validateName,
  validateNamespace,
  validateQualifierKey,
  validateQualifiers,
  validateSubpath,
  validateType,
  validateVersion
} = require('./validate')

const componentSortOrderLookup = {
  __proto__: null,
  type: 0,
  namespace: 1,
  name: 2,
  version: 3,
  qualifiers: 4,
  qualifierKey: 5,
  qualifierValue: 6,
  subpath: 7
}

function componentSortOrder(comp) {
  return componentSortOrderLookup[comp] ?? comp
}

function componentComparator(compA, compB) {
  return localeCompare(componentSortOrder(compA), componentSortOrder(compB))
}

function PurlComponentEncoder(comp) {
  return isNonEmptyString(comp) ? encodeComponent(comp) : ''
}

function PurlComponentStringNormalizer(comp) {
  return typeof comp === 'string' ? comp : undefined
}

function PurlComponentValidator(_comp, _throws) {
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
      subpath: encodeSubpath
    },
    normalize: {
      type: normalizeType,
      namespace: normalizeNamespace,
      name: normalizeName,
      version: normalizeVersion,
      qualifiers: normalizeQualifiers,
      subpath: normalizeSubpath
    },
    validate: {
      type: validateType,
      namespace: validateNamespace,
      name: validateName,
      version: validateVersion,
      qualifierKey: validateQualifierKey,
      qualifiers: validateQualifiers,
      subpath: validateSubpath
    }
  },
  {
    comparator: componentComparator,
    encode: PurlComponentEncoder,
    normalize: PurlComponentStringNormalizer,
    validate: PurlComponentValidator
  }
)

module.exports = {
  PurlComponent,
  PurlComponentEncoder,
  PurlComponentStringNormalizer,
  PurlComponentValidator,
  componentComparator,
  componentSortOrder
}
