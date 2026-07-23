/**
 * @file Validation functions for PURL components. Ensures compliance with
 *   Package URL specification requirements and constraints.
 */
import { PurlError, PurlInjectionError } from './error.mjs'
import { ArrayIsArray } from '@socketsecurity/lib/primordials/array'
import { ObjectKeys } from '@socketsecurity/lib/primordials/object'
import { ReflectApply } from '@socketsecurity/lib/primordials/reflect'
import { StringPrototypeCharCodeAt } from '@socketsecurity/lib/primordials/string'
import {
  findCommandInjectionCharCode,
  formatInjectionChar,
} from './strings.mjs'

import type { QualifiersObject } from './purl-component.mjs'

export {
  validateEmptyByType,
  validateNoInjectionByType,
  validateRequired,
  validateRequiredByType,
  validateStartsWithoutNumber,
  validateStrings,
} from './validate-primitives.mjs'

import {
  validateRequired,
  validateStartsWithoutNumber,
  validateStrings,
} from './validate-primitives.mjs'

/**
 * Validate package name component.
 *
 * @throws {PurlError} When validation fails and options.throws is true.
 */
export function validateName(
  name: unknown,
  options?: { throws?: boolean | undefined } | undefined,
): boolean {
  const opts = options
  const { throws = false } = opts ?? {}

  // First validate it's a required string
  if (
    !validateRequired('name', name, opts) ||
    !validateStrings('name', name, opts)
  ) {
    return false
  }

  // Validate length (npm package name limit is `214` characters)
  const MAX_NAME_LENGTH = 214
  if (typeof name === 'string' && name.length > MAX_NAME_LENGTH) {
    if (throws) {
      throw new PurlError(
        `"name" exceeds maximum length of ${MAX_NAME_LENGTH} characters`,
      )
    }
    return false
  }

  return true
}

/**
 * Validate package namespace component.
 *
 * @throws {PurlError} When validation fails and options.throws is true.
 */
export function validateNamespace(
  namespace: unknown,
  options?: { throws?: boolean | undefined } | undefined,
): boolean {
  const opts = options
  const { throws = false } = opts ?? {}

  if (!validateStrings('namespace', namespace, opts)) {
    return false
  }

  // Validate length (reasonable limit for namespace)
  const MAX_NAMESPACE_LENGTH = 512
  if (
    typeof namespace === 'string' &&
    namespace.length > MAX_NAMESPACE_LENGTH
  ) {
    if (throws) {
      throw new PurlError(
        `"namespace" exceeds maximum length of ${MAX_NAMESPACE_LENGTH} characters`,
      )
    }
    return false
  }

  return true
}

/**
 * Validate qualifier key format and characters.
 *
 * @throws {PurlError} When validation fails and options.throws is true.
 */
export function validateQualifierKey(
  key: string,
  options?: { throws?: boolean | undefined } | undefined,
): boolean {
  const opts = options
  const { throws = false } = opts ?? {}
  // Qualifier keys must not be empty
  if (key.length === 0) {
    if (throws) {
      throw new PurlError('qualifier key must not be empty')
    }
    return false
  }
  // Qualifier keys must not exceed reasonable length
  const MAX_QUALIFIER_KEY_LENGTH = 256
  if (key.length > MAX_QUALIFIER_KEY_LENGTH) {
    if (throws) {
      throw new PurlError(
        `qualifier key exceeds maximum length of ${MAX_QUALIFIER_KEY_LENGTH} characters`,
      )
    }
    return false
  }
  // A key cannot start with a number
  if (!validateStartsWithoutNumber('qualifier', key, opts)) {
    return false
  }
  // The key must be composed only of ASCII letters and numbers,
  // `'.'`, `'-'` and `'_'` (period, dash and underscore)
  for (let i = 0, { length } = key; i < length; i += 1) {
    const code = StringPrototypeCharCodeAt(key, i)
    // biome-ignore format: newlines
    if (
      !(
        // 0-9
        (
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
        )
        // _
      )
    ) {
      if (throws) {
        throw new PurlError(`qualifier key "${key}" must match [a-z0-9.\\-_]`)
      }
      return false
    }
  }
  return true
}

/**
 * Validate qualifiers object structure and keys.
 *
 * @throws {PurlError} When validation fails and options.throws is true.
 */
export function validateQualifiers(
  qualifiers: unknown,
  options?: { throws?: boolean | undefined } | undefined,
): boolean {
  const opts = options
  const { throws = false } = opts ?? {}
  if (qualifiers === null || qualifiers === undefined) {
    return true
  }
  if (typeof qualifiers !== 'object' || ArrayIsArray(qualifiers)) {
    if (throws) {
      throw new PurlError('"qualifiers" must be a plain object')
    }
    return false
  }
  const qualifiersObj = qualifiers as QualifiersObject | URLSearchParams
  const keysProperty = (qualifiersObj as QualifiersObject)['keys']
  // type-coverage:ignore-next-line -- TypeScript correctly infers this type through the ternary and cast
  const keysIterable: Iterable<string> =
    // `URLSearchParams` instances have a `"keys"` method that returns an iterator
    typeof keysProperty === 'function'
      ? ReflectApply(keysProperty, qualifiersObj, [])
      : ObjectKeys(qualifiers)
  // Use `for-of` to work with `URLSearchParams#keys` iterators
  // oxlint-disable-next-line socket/prefer-cached-for-loop -- `keysIterable` is a generic `Iterable<string>` (URLSearchParams keys iterator), not an indexable array.
  // type-coverage:ignore-next-line -- TypeScript correctly infers the iteration type
  for (const key of keysIterable) {
    if (typeof key !== 'string') {
      if (throws) {
        throw new PurlError('qualifier key must be a string')
      }
      return false
    }
    if (!validateQualifierKey(key, opts)) {
      return false
    }
    // Validate qualifier values for command injection characters.
    // Uses the narrower command injection scanner to allow URL-safe characters
    // (`?`, `&`, `=`, `:`, `/`, `#`) that are legitimate in qualifier values like
    // `download_url`, `repository_url`, and `vcs_url`.
    const value =
      typeof (qualifiersObj as QualifiersObject)[key] === 'string'
        ? ((qualifiersObj as QualifiersObject)[key] as string)
        : undefined
    if (value !== undefined) {
      // Qualifier values must not exceed reasonable length
      const MAX_QUALIFIER_VALUE_LENGTH = 65_536
      if (value.length > MAX_QUALIFIER_VALUE_LENGTH) {
        if (throws) {
          throw new PurlError(
            `qualifier "${key}" value exceeds maximum length of ${MAX_QUALIFIER_VALUE_LENGTH} characters`,
          )
        }
        return false
      }
      const code = findCommandInjectionCharCode(value)
      if (code !== -1) {
        if (throws) {
          throw new PurlInjectionError(
            'purl',
            `qualifier "${key}"`,
            code,
            formatInjectionChar(code),
          )
        }
        return false
      }
    }
  }
  return true
}

/**
 * Validate subpath component. Rejects command injection characters (`|`, `;`,
 * `` ` ``, `$`, `<`, `>`, `\`) while allowing characters that are legitimate in
 * decoded subpaths (`?`, `#`, space, etc. which get percent-encoded in the PURL
 * string representation).
 *
 * @throws {PurlInjectionError} When command injection characters found and
 *   `options.throws` is `true`.
 * @throws {PurlError} When validation fails and `options.throws` is `true`.
 */
export function validateSubpath(
  subpath: unknown,
  options?: { throws?: boolean | undefined } | undefined,
): boolean {
  const opts = options
  const { throws = false } = opts ?? {}
  if (!validateStrings('subpath', subpath, opts)) {
    return false
  }
  if (typeof subpath === 'string') {
    const code = findCommandInjectionCharCode(subpath)
    if (code !== -1) {
      if (throws) {
        throw new PurlInjectionError(
          'purl',
          'subpath',
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
 * Validate package type component format and characters.
 *
 * @throws {PurlError} When validation fails and options.throws is true.
 */
export function validateType(
  type: unknown,
  options?: { throws?: boolean | undefined } | undefined,
): boolean {
  const opts = options
  const { throws = false } = opts ?? {}
  // The type cannot be nullish, an empty string, or start with a number
  if (
    !validateRequired('type', type, opts) ||
    !validateStrings('type', type, opts) ||
    !validateStartsWithoutNumber('type', type as string, opts)
  ) {
    return false
  }
  // The package type is composed only of ASCII letters and numbers,
  // `'.'` (period), and `'-'` (dash)
  for (let i = 0, { length } = type as string; i < length; i += 1) {
    const code = StringPrototypeCharCodeAt(type as string, i)
    // biome-ignore format: newlines
    if (
      !(
        // 0-9
        (
          (code >= 48 && code <= 57) ||
          // A-Z
          (code >= 65 && code <= 90) ||
          // a-z
          (code >= 97 && code <= 122) ||
          // .
          code === 46 ||
          code === 45
        )
        // -
      )
    ) {
      if (throws) {
        throw new PurlError(`type "${type}" must match [A-Za-z0-9.\\-]`)
        /* v8 ignore next -- Unreachable code after throw. */
      }
      return false
    }
  }
  return true
}

/**
 * Validate package version component. Rejects command injection characters
 * (`|`, `;`, `` ` ``, `$`, `<`, `>`, `\`) while allowing characters legitimate
 * in version strings (`!`, `+`, `-`, `.`, `_`, `~`, space, `%`, `?`, `#`).
 *
 * @throws {PurlInjectionError} When command injection characters found and
 *   `options.throws` is `true`.
 * @throws {PurlError} When validation fails and `options.throws` is `true`.
 */
export function validateVersion(
  version: unknown,
  options?: { throws?: boolean | undefined } | undefined,
): boolean {
  const opts = options
  const { throws = false } = opts ?? {}

  if (!validateStrings('version', version, opts)) {
    return false
  }

  // Validate length (reasonable limit for version strings)
  const MAX_VERSION_LENGTH = 256
  if (typeof version === 'string' && version.length > MAX_VERSION_LENGTH) {
    if (throws) {
      throw new PurlError(
        `"version" exceeds maximum length of ${MAX_VERSION_LENGTH} characters`,
      )
    }
    return false
  }

  // Reject command injection characters
  if (typeof version === 'string') {
    const code = findCommandInjectionCharCode(version)
    if (code !== -1) {
      if (throws) {
        throw new PurlInjectionError(
          'purl',
          'version',
          code,
          formatInjectionChar(code),
        )
      }
      return false
    }
  }

  return true
}
