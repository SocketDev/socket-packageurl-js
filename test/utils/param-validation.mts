/**
 * @fileoverview Utilities for testing PackageURL parameter validation
 */

import { expect } from 'vitest'

import { PackageURL } from '../../dist/package-url.js'

type ParamValue = unknown
type CreateArgsFn = (
  _name: string,
  _value: ParamValue,
) => [unknown, unknown, unknown, unknown, unknown, unknown]

/**
 * Test parameter validation with various test values.
 * @param paramName - Name of the parameter to test
 * @param paramMap - Map of parameter names to argument positions
 * @param createArgs - Function to create constructor arguments
 * @param testValues - Array of values to test
 * @param shouldThrow - Whether the values should cause errors
 */
export function testParam(
  paramName: string,
  paramMap: Record<string, number>,
  createArgs: CreateArgsFn,
  testValues: ParamValue[],
  shouldThrow: boolean,
) {
  const paramIndex = paramMap[paramName]
  testValues.forEach(value => {
    const args = createArgs(paramName, value)
    const message = JSON.stringify(args[paramIndex])
    if (shouldThrow) {
      expect(() => new PackageURL(...args), message).toThrow()
    } else {
      expect(() => new PackageURL(...args), message).not.toThrow()
    }
  })
}

/**
 * Test that required parameters are validated correctly.
 * Tests various invalid inputs that should all throw.
 */
export function testInvalidParam(
  paramName: string,
  paramMap: Record<string, number>,
  createArgs: CreateArgsFn,
) {
  testParam(
    paramName,
    paramMap,
    createArgs,
    [0, false, 1, true, {}, null, undefined, ''],
    true,
  )
}

/**
 * Test that optional string parameters accept valid string values.
 * Tests various valid inputs that should all succeed.
 */
export function testValidStringParam(
  paramName: string,
  paramMap: Record<string, number>,
  createArgs: CreateArgsFn,
) {
  testParam(
    paramName,
    paramMap,
    createArgs,
    [paramName, null, undefined, ''],
    false,
  )
}

/**
 * Test that string parameters reject non-string values.
 * Tests various invalid type inputs that should all throw.
 */
export function testInvalidStringParam(
  paramName: string,
  paramMap: Record<string, number>,
  createArgs: CreateArgsFn,
) {
  testParam(paramName, paramMap, createArgs, [0, false, 1, true, {}], true)
}

/**
 * Test that required parameters accept valid values.
 */
export function testValidParam(
  paramName: string,
  paramMap: Record<string, number>,
  createArgs: CreateArgsFn,
) {
  testParam(paramName, paramMap, createArgs, [paramName], false)
}
