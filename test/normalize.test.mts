/**
 * @file Tests for normalize.mts — normalizeQualifiers and related utilities.
 */
import { describe, expect, it } from 'vitest'

import { normalizeQualifiers } from '../src/normalize.mjs'

describe('normalizeQualifiers non-string key handling', () => {
  it('skips non-string keys surfaced by a custom entries iterator', () => {
    const rawQualifiers = {
      entries() {
        return (
          [
            [42, 'ignored'],
            ['real', 'kept'],
          ] as unknown as Array<[string, string]>
        )[Symbol.iterator]()
      },
    }
    const result = normalizeQualifiers(rawQualifiers)
    expect(result).toEqual({ real: 'kept' })
  })
})
