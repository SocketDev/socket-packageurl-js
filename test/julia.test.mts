/**
 * @file Tests for julia.mts — validate and related utilities.
 */
import { describe, expect, it } from 'vitest'

import { validate as validateJulia } from '../src/purl-types/julia.mjs'

describe('per-type validate: julia', () => {
  it('rejects a name containing an injection character', () => {
    expect(
      validateJulia({
        name: 'Da;tes',
        qualifiers: { uuid: 'ade2ca70-3891-5945-98fb-dc099432e06a' },
        type: 'julia',
      }),
    ).toBe(false)
  })
})
