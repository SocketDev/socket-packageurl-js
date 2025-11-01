/**
 * @fileoverview Test assertion helpers to reduce duplication.
 *
 * These utilities help maintain DRY principles in tests by providing
 * reusable assertion patterns for common test scenarios.
 */

import { expect } from 'vitest'

import type { PackageURL } from '../../src/package-url.js'

/**
 * Assert that a PackageURL instance has expected properties.
 *
 * @example
 * expectPurlProperties(purl, {
 *   type: 'npm',
 *   name: 'lodash',
 *   version: '4.17.21'
 * })
 */
export function expectPurlProperties(
  purl: PackageURL,
  expected: {
    type: string
    namespace?: string
    name: string
    version?: string
    qualifiers?: Record<string, string> | null
    subpath?: string
  },
): void {
  expect(purl.type).toBe(expected.type)

  if (expected.namespace !== undefined) {
    expect(purl.namespace).toBe(expected.namespace)
  } else {
    expect(purl.namespace).toBe(undefined)
  }

  expect(purl.name).toBe(expected.name)

  if (expected.version !== undefined) {
    expect(purl.version).toBe(expected.version)
  } else {
    expect(purl.version).toBe(undefined)
  }

  if (expected.qualifiers !== undefined) {
    if (expected.qualifiers === null) {
      expect(purl.qualifiers).toBe(undefined)
    } else {
      expect(purl.qualifiers).toStrictEqual(expected.qualifiers)
    }
  } else {
    expect(purl.qualifiers).toBe(undefined)
  }

  if (expected.subpath !== undefined) {
    expect(purl.subpath).toBe(expected.subpath)
  } else {
    expect(purl.subpath).toBe(undefined)
  }
}

/**
 * Assert that two PackageURL instances are equal in all properties.
 *
 * @example
 * const original = PackageURL.fromString('pkg:npm/lodash@4.17.21')
 * const restored = PackageURL.fromJSON(original.toJSONString())
 * expectPurlEquality(restored, original)
 */
export function expectPurlEquality(purl1: PackageURL, purl2: PackageURL): void {
  expect(purl1.type).toBe(purl2.type)
  expect(purl1.namespace).toBe(purl2.namespace)
  expect(purl1.name).toBe(purl2.name)
  expect(purl1.version).toBe(purl2.version)
  expect(purl1.qualifiers).toStrictEqual(purl2.qualifiers)
  expect(purl1.subpath).toBe(purl2.subpath)
  expect(purl1.toString()).toBe(purl2.toString())
}

/**
 * Test a validator function in both throwing and non-throwing modes.
 *
 * @example
 * testThrowingAndNonThrowing(
 *   () => validateName('invalid name'),
 *   false, // shouldPass
 *   /invalid name format/
 * )
 */
export function testThrowingAndNonThrowing(
  validator: (opts: { throws: boolean }) => boolean | never,
  shouldPass: boolean,
  errorPattern?: RegExp | string,
): void {
  // Non-throwing mode
  const result = validator({ throws: false })
  expect(result).toBe(shouldPass)

  // Throwing mode
  if (shouldPass) {
    expect(() => validator({ throws: true })).not.toThrow()
  } else {
    if (errorPattern) {
      expect(() => validator({ throws: true })).toThrow(errorPattern)
    } else {
      expect(() => validator({ throws: true })).toThrow()
    }
  }
}
