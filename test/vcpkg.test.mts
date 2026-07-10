/**
 * @file Tests for vcpkg.mts — validate and related utilities.
 */
import { describe, expect, it } from 'vitest'

import { validate as validateVcpkg } from '../src/purl-types/vcpkg.mjs'

describe('per-type validate: vcpkg', () => {
  it('rejects a name containing an injection character', () => {
    expect(validateVcpkg({ name: 'boost;asio', type: 'vcpkg' })).toBe(false)
  })
})
