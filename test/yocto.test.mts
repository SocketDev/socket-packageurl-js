/**
 * @file Tests for yocto.mts — validate and related utilities.
 */
import { describe, expect, it } from 'vitest'

import { validate as validateYocto } from '../src/purl-types/yocto.mjs'

describe('per-type validate: yocto', () => {
  it('rejects a namespace containing an injection character', () => {
    expect(
      validateYocto({ name: 'busybox', namespace: 'laye;r', type: 'yocto' }),
    ).toBe(false)
  })
})
