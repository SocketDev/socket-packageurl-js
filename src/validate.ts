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
  options?: { throws?: boolean } | boolean,
): boolean {
  // Support both legacy boolean parameter and new options object for backward compatibility.
  const { throws = false } =
    typeof options === 'boolean' ? { throws: options } : (options ?? {})
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
 * @throws {PurlError} When validation fails and options.throws is true.
 */
function validateName(
  name: unknown,
  options?: { throws?: boolean } | boolean,
): boolean {
  // Support both legacy boolean parameter and new options object for backward compatibility.
  const opts = typeof options === 'boolean' ? { throws: options } : options
  return (
    validateRequired('name', name, opts) && validateStrings('name', name, opts)
  )
}

/**
 * Validate package namespace component.
 * @throws {PurlError} When validation fails and options.throws is true.
 */
function validateNamespace(
  namespace: unknown,
  options?: { throws?: boolean } | boolean,
): boolean {
  // Support both legacy boolean parameter and new options object for backward compatibility.
  const opts = typeof options === 'boolean' ? { throws: options } : options
  return validateStrings('namespace', namespace, opts)
}

/**
 * Validate qualifier key format and characters.
 * @throws {PurlError} When validation fails and options.throws is true.
 */
function validateQualifierKey(
  key: string,
  options?: { throws?: boolean } | boolean,
): boolean {
  // Support both legacy boolean parameter and new options object for backward compatibility.
  const opts = typeof options === 'boolean' ? { throws: options } : options
  const { throws = false } = opts ?? {}
  // A key cannot start with a number.
  if (!validateStartsWithoutNumber('qualifier', key, opts)) {
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
 * @throws {PurlError} When validation fails and options.throws is true.
 */
function validateQualifiers(
  qualifiers: unknown,
  options?: { throws?: boolean } | boolean,
): boolean {
  // Support both legacy boolean parameter and new options object for backward compatibility.
  const opts = typeof options === 'boolean' ? { throws: options } : options
  const { throws = false } = opts ?? {}
  if (qualifiers === null || qualifiers === undefined) {
    return true
  }
  if (typeof qualifiers !== 'object' || Array.isArray(qualifiers)) {
    if (throws) {
      throw new PurlError('"qualifiers" must be a plain object')
    }
    return false
  }
  const qualifiersObj = qualifiers as QualifiersObject | URLSearchParams
  const keysProperty = (qualifiersObj as QualifiersObject)['keys']
  // type-coverage:ignore-next-line -- TypeScript correctly infers this type through the ternary and cast
  const keysIterable: Iterable<string> =
    // URLSearchParams instances have a "keys" method that returns an iterator.
    (
      typeof keysProperty === 'function'
        ? ReflectApply(keysProperty, qualifiersObj, [])
        : Object.keys(qualifiers as QualifiersObject)
    ) as Iterable<string>
  // Use for-of to work with URLSearchParams#keys iterators.
  // type-coverage:ignore-next-line -- TypeScript correctly infers the iteration type
  for (const key of keysIterable) {
    if (!validateQualifierKey(key, opts)) {
      return false
    }
  }
  return true
}

/**
 * Validate that component is present and not empty.
 * @throws {PurlError} When validation fails and options.throws is true.
 */
function validateRequired(
  name: string,
  value: unknown,
  options?: { throws?: boolean } | boolean,
): boolean {
  // Support both legacy boolean parameter and new options object for backward compatibility.
  const { throws = false } =
    typeof options === 'boolean' ? { throws: options } : (options ?? {})
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
 * @throws {PurlError} When validation fails and options.throws is true.
 */
function validateRequiredByType(
  type: string,
  name: string,
  value: unknown,
  options?: { throws?: boolean } | boolean,
): boolean {
  // Support both legacy boolean parameter and new options object for backward compatibility.
  const { throws = false } =
    typeof options === 'boolean' ? { throws: options } : (options ?? {})
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
 * @throws {PurlError} When validation fails and options.throws is true.
 */
function validateStartsWithoutNumber(
  name: string,
  value: string,
  options?: { throws?: boolean } | boolean,
): boolean {
  // Support both legacy boolean parameter and new options object for backward compatibility.
  const { throws = false } =
    typeof options === 'boolean' ? { throws: options } : (options ?? {})
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
 * @throws {PurlError} When validation fails and options.throws is true.
 */
function validateStrings(
  name: string,
  value: unknown,
  options?: { throws?: boolean } | boolean,
): boolean {
  // Support both legacy boolean parameter and new options object for backward compatibility.
  const { throws = false } =
    typeof options === 'boolean' ? { throws: options } : (options ?? {})
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
 * @throws {PurlError} When validation fails and options.throws is true.
 */
function validateSubpath(
  subpath: unknown,
  options?: { throws?: boolean } | boolean,
): boolean {
  // Support both legacy boolean parameter and new options object for backward compatibility.
  const opts = typeof options === 'boolean' ? { throws: options } : options
  return validateStrings('subpath', subpath, opts)
}

/**
 * Validate package type component format and characters.
 * @throws {PurlError} When validation fails and options.throws is true.
 */
function validateType(
  type: unknown,
  options?: { throws?: boolean } | boolean,
): boolean {
  // Support both legacy boolean parameter and new options object for backward compatibility.
  const opts = typeof options === 'boolean' ? { throws: options } : options
  const { throws = false } = opts ?? {}
  // The type cannot be nullish, an empty string, or start with a number.
  if (
    !validateRequired('type', type, opts) ||
    !validateStrings('type', type, opts) ||
    !validateStartsWithoutNumber('type', type as string, opts)
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
 * @throws {PurlError} When validation fails and options.throws is true.
 */
function validateVersion(
  version: unknown,
  options?: { throws?: boolean } | boolean,
): boolean {
  // Support both legacy boolean parameter and new options object for backward compatibility.
  const opts = typeof options === 'boolean' ? { throws: options } : options
  return validateStrings('version', version, opts)
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
