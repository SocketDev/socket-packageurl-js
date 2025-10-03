/**
 * @fileoverview Validation functions for PURL components.
 * Ensures compliance with Package URL specification requirements and constraints.
 */
import { PurlError } from './error.js'
import { isNullishOrEmptyString } from './lang.js'
import { isNonEmptyString } from './strings.js'

import type { QualifiersObject } from './purl-component.js'

// IMPORTANT: Do not use destructuring here - use direct assignment instead.
// tsgo has a bug that incorrectly transpiles destructured exports, resulting in
// `exports.ReflectApply = void 0;` which causes runtime errors.
// See: https://github.com/SocketDev/socket-packageurl-js/issues/3
const ReflectApply = Reflect.apply

/**
 * Validate that component is empty for specific package type.
 */
function validateEmptyByType(
  type: string,
  name: string,
  value: unknown,
  throws: boolean,
): boolean {
  if (!isNullishOrEmptyString(value)) {
    if (throws) {
      throw new PurlError(`${type} "${name}" component must be empty`)
    }
    return false
  }
  return true
}

/**
 * Validate package name component.
 * @throws {PurlError} When validation fails and throws is true.
 */
function validateName(name: unknown, throws: boolean): boolean {
  return (
    validateRequired('name', name, throws) &&
    validateStrings('name', name, throws)
  )
}

/**
 * Validate package namespace component.
 * @throws {PurlError} When validation fails and throws is true.
 */
function validateNamespace(namespace: unknown, throws: boolean): boolean {
  return validateStrings('namespace', namespace, throws)
}

/**
 * Validate qualifier key format and characters.
 * @throws {PurlError} When validation fails and throws is true.
 */
function validateQualifierKey(key: string, throws: boolean): boolean {
  // A key cannot start with a number.
  if (!validateStartsWithoutNumber('qualifier', key, throws)) {
    return false
  }
  // The key must be composed only of ASCII letters and numbers,
  // '.', '-' and '_' (period, dash and underscore).
  for (let i = 0, { length } = key as string; i < length; i += 1) {
    const code = (key as string).charCodeAt(i)
    // biome-ignore format: newlines
    if (
      !(
        (
          // 0-9
          (code >= 48 && code <= 57) ||
          // A-Z
          (code >= 65 && code <= 90) ||
          // a-z
          (code >= 97 && code <= 122) ||
          // .
          code === 46 ||
          // -
          code === 45 ||
          code === 95
        // _
        )
      )
    ) {
      if (throws) {
        throw new PurlError(`qualifier "${key}" contains an illegal character`)
      }
      return false
    }
  }
  return true
}

/**
 * Validate qualifiers object structure and keys.
 * @throws {PurlError} When validation fails and throws is true.
 */
function validateQualifiers(qualifiers: unknown, throws: boolean): boolean {
  if (qualifiers === null || qualifiers === undefined) {
    return true
  }
  if (typeof qualifiers !== 'object') {
    if (throws) {
      throw new PurlError('"qualifiers" must be an object')
    }
    return false
  }
  const qualifiersObj = qualifiers as QualifiersObject | URLSearchParams
  const keysProperty = (qualifiersObj as QualifiersObject)['keys']
  const keysIterable: Iterable<string> =
    // URLSearchParams instances have a "keys" method that returns an iterator.
    typeof keysProperty === 'function'
      ? (ReflectApply(keysProperty, qualifiersObj, []) as Iterable<string>)
      : (Object.keys(qualifiers as QualifiersObject) as Iterable<string>)
  // Use for-of to work with URLSearchParams#keys iterators.
  for (const key of keysIterable) {
    if (!validateQualifierKey(key, throws)) {
      return false
    }
  }
  return true
}

/**
 * Validate that component is present and not empty.
 * @throws {PurlError} When validation fails and throws is true.
 */
function validateRequired(
  name: string,
  value: unknown,
  throws: boolean,
): boolean {
  if (isNullishOrEmptyString(value)) {
    if (throws) {
      throw new PurlError(`"${name}" is a required component`)
    }
    return false
  }
  return true
}

/**
 * Validate that component is required for specific package type.
 * @throws {PurlError} When validation fails and throws is true.
 */
function validateRequiredByType(
  type: string,
  name: string,
  value: unknown,
  throws: boolean,
): boolean {
  if (isNullishOrEmptyString(value)) {
    if (throws) {
      throw new PurlError(`${type} requires a "${name}" component`)
    }
    return false
  }
  return true
}

/**
 * Validate that value does not start with a number.
 * @throws {PurlError} When validation fails and throws is true.
 */
function validateStartsWithoutNumber(
  name: string,
  value: string,
  throws: boolean,
): boolean {
  if (isNonEmptyString(value)) {
    const code = value.charCodeAt(0)
    if (code >= 48 /*'0'*/ && code <= 57 /*'9'*/) {
      if (throws) {
        throw new PurlError(`${name} "${value}" cannot start with a number`)
      }
      return false
    }
  }
  return true
}

/**
 * Validate that value is a string type.
 * @throws {PurlError} When validation fails and throws is true.
 */
function validateStrings(
  name: string,
  value: unknown,
  throws: boolean,
): boolean {
  if (value === null || value === undefined || typeof value === 'string') {
    return true
  }
  if (throws) {
    throw new PurlError(`"${name}" must be a string`)
  }
  return false
}

/**
 * Validate subpath component.
 * @throws {PurlError} When validation fails and throws is true.
 */
function validateSubpath(subpath: unknown, throws: boolean): boolean {
  return validateStrings('subpath', subpath, throws)
}

/**
 * Validate package type component format and characters.
 * @throws {PurlError} When validation fails and throws is true.
 */
function validateType(type: unknown, throws: boolean): boolean {
  // The type cannot be nullish, an empty string, or start with a number.
  if (
    !validateRequired('type', type, throws) ||
    !validateStrings('type', type, throws) ||
    !validateStartsWithoutNumber('type', type as string, throws)
  ) {
    return false
  }
  // The package type is composed only of ASCII letters and numbers,
  // '.' (period), and '-' (dash).
  for (let i = 0, { length } = type as string; i < length; i += 1) {
    const code = (type as string).charCodeAt(i)
    // biome-ignore format: newlines
    if (
      !(
        (
          // 0-9
          (code >= 48 && code <= 57) ||
          // A-Z
          (code >= 65 && code <= 90) ||
          // a-z
          (code >= 97 && code <= 122) ||
          // .
          code === 46 ||
          code === 45
        // -
        )
      )
    ) {
      if (throws) {
        throw new PurlError(`type "${type}" contains an illegal character`)
        /* c8 ignore next -- Unreachable code after throw. */
      }
      return false
    }
  }
  return true
}

/**
 * Validate package version component.
 * @throws {PurlError} When validation fails and throws is true.
 */
function validateVersion(version: unknown, throws: boolean): boolean {
  return validateStrings('version', version, throws)
}

export {
  validateEmptyByType,
  validateName,
  validateNamespace,
  validateQualifiers,
  validateQualifierKey,
  validateRequired,
  validateRequiredByType,
  validateStartsWithoutNumber,
  validateStrings,
  validateSubpath,
  validateType,
  validateVersion,
}
