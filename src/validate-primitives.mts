/**
 * @file Primitive validation helpers shared by PURL component validators.
 *   Checks for required presence, string type, null bytes, injection
 *   characters, and leading-digit constraints.
 */
import { PurlError, PurlInjectionError } from './error.mjs'
import { isNullishOrEmptyString } from './lang.mjs'
import {
  StringPrototypeCharCodeAt,
  StringPrototypeIncludes,
} from '@socketsecurity/lib/primordials/string'
import {
  findInjectionCharCode,
  formatInjectionChar,
  isNonEmptyString,
} from './strings.mjs'

/**
 * Validate that component is empty for specific package type.
 */
export function validateEmptyByType(
  type: string,
  name: string,
  value: unknown,
  options?: { throws?: boolean | undefined } | undefined,
): boolean {
  const { throws = false } = options ?? {}
  if (!isNullishOrEmptyString(value)) {
    if (throws) {
      throw new PurlError(`${type} "${name}" component must be empty`)
    }
    return false
  }
  return true
}

/**
 * Validate that a component does not contain injection characters. Shared
 * helper to eliminate boilerplate across per-type validators.
 *
 * @throws {PurlInjectionError} When validation fails and `throws` is `true`.
 *   The error includes the specific character code, component name, and package
 *   type so callers can log, alert, or handle injection attempts at an elevated
 *   level.
 */
export function validateNoInjectionByType(
  type: string,
  component: string,
  value: string | undefined,
  options?: { throws?: boolean | undefined } | undefined,
): boolean {
  const { throws = false } = options ?? {}
  if (typeof value === 'string') {
    const code = findInjectionCharCode(value)
    if (code !== -1) {
      if (throws) {
        throw new PurlInjectionError(
          type,
          component,
          code,
          formatInjectionChar(code),
        )
      }
      return false
    }
  }
  return true
}

/**
 * Validate that component is present and not empty.
 *
 * @throws {PurlError} When validation fails and options.throws is true.
 */
export function validateRequired(
  name: string,
  value: unknown,
  options?: { throws?: boolean | undefined } | undefined,
): boolean {
  const { throws = false } = options ?? {}
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
 *
 * @throws {PurlError} When validation fails and options.throws is true.
 */
export function validateRequiredByType(
  type: string,
  name: string,
  value: unknown,
  options?: { throws?: boolean | undefined } | undefined,
): boolean {
  const { throws = false } = options ?? {}
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
 *
 * @throws {PurlError} When validation fails and options.throws is true.
 */
export function validateStartsWithoutNumber(
  name: string,
  value: string,
  options?: { throws?: boolean | undefined } | undefined,
): boolean {
  const { throws = false } = options ?? {}
  if (isNonEmptyString(value)) {
    const code = StringPrototypeCharCodeAt(value, 0)
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
 *
 * @throws {PurlError} When validation fails and options.throws is true.
 */
export function validateStrings(
  name: string,
  value: unknown,
  options?: { throws?: boolean | undefined } | undefined,
): boolean {
  const { throws = false } = options ?? {}
  if (value === null || value === undefined) {
    return true
  }
  if (typeof value !== 'string') {
    if (throws) {
      throw new PurlError(`"${name}" must be a string`)
    }
    return false
  }
  // Reject `null` bytes which cause truncation in C-based consumers
  if (StringPrototypeIncludes(value, '\x00')) {
    if (throws) {
      throw new PurlError(`"${name}" must not contain null bytes`)
    }
    return false
  }
  return true
}
