/**
 * @file Tests for chrome-extension.mts — validate and related utilities.
 */
import { describe, expect, it } from 'vitest'

import { validate as validateChromeExtension } from '../src/purl-types/chrome-extension.mjs'

describe('per-type validate: chrome-extension', () => {
  it('rejects a non-empty namespace', () => {
    expect(
      validateChromeExtension({
        name: 'hlepfoohegkhhmjieoechaddaejaokhf',
        namespace: 'store',
        type: 'chrome-extension',
      }),
    ).toBe(false)
  })
})
