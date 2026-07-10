/**
 * @file Tests for validate-primitives.mts — validateNoInjectionByType and
 *   related utilities.
 */
import { describe, expect, it } from 'vitest'

import { validateNoInjectionByType } from '../src/validate-primitives.mjs'

describe('validate-primitives.mts — validateNoInjectionByType default options', () => {
  it('defaults to {} and returns true when called without an options argument', () => {
    expect(validateNoInjectionByType('npm', 'name', 'safe-name')).toBe(true)
  })
})
