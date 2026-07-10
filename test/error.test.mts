/**
 * @file Unit tests for PurlError and PurlInjectionError classes. Tests
 *   PurlInjectionError instance properties, frozen prototype, and error
 *   message formatting.
 */
import { describe, expect, it } from 'vitest'

import { PurlError, PurlInjectionError } from '../src/error.mjs'
import { PackageURL } from '../src/package-url.mjs'

export function getInjectionError(fn: () => unknown): PurlInjectionError {
  let caught: unknown
  try {
    fn()
  } catch (e) {
    caught = e
  }
  // oxlint-disable-next-line socket/no-vitest-standalone-expect -- assertion helper; callers invoke this from within it() blocks.
  expect(caught).toBeInstanceOf(PurlInjectionError)
  return caught as PurlInjectionError
}

describe('Per-type injection character validation (continued)', () => {
  describe('PurlInjectionError', () => {
    it('should be an instance of both PurlInjectionError and PurlError', () => {
      expect(
        () =>
          new PackageURL(
            'cargo',
            undefined,
            'pkg|evil',
            '1.0.0',
            undefined,
            undefined,
          ),
      ).toThrow(PurlInjectionError)
    })

    it('should be catchable as PurlError (superclass)', () => {
      expect(
        () =>
          new PackageURL(
            'cargo',
            undefined,
            'pkg|evil',
            '1.0.0',
            undefined,
            undefined,
          ),
      ).toThrow(PurlError)
    })

    it('should expose charCode, component, and purlType properties', () => {
      const err = getInjectionError(
        () =>
          new PackageURL(
            'maven',
            'org;evil',
            'artifact',
            '1.0.0',
            undefined,
            undefined,
          ),
      )
      expect(err.purlType).toBe('maven')
      expect(err.component).toBe('namespace')
      expect(err.charCode).toBe(0x3b) // semicolon
    })

    it('should include the specific character in the error message', () => {
      const err = getInjectionError(
        () =>
          new PackageURL(
            'cargo',
            undefined,
            'pkg$name',
            '1.0.0',
            undefined,
            undefined,
          ),
      )
      expect(err.message).toContain('"$" (0x24)')
    })

    it('should format control characters as hex codes', () => {
      const err = getInjectionError(
        () =>
          new PackageURL(
            'gem',
            undefined,
            'pkg\x1bname',
            '1.0.0',
            undefined,
            undefined,
          ),
      )
      expect(err.charCode).toBe(0x1b) // ESC
      expect(err.message).toContain('0x1b')
    })

    it('should have a frozen instance (properties cannot be tampered)', () => {
      const err = getInjectionError(
        () =>
          new PackageURL(
            'cargo',
            undefined,
            'pkg|evil',
            '1.0.0',
            undefined,
            undefined,
          ),
      )
      expect(Object.isFrozen(err)).toBe(true)
      // Properties should not be writable
      expect(() => {
        ;(err as unknown as Record<string, unknown>)['charCode'] = 0
      }).toThrow()
      expect(() => {
        ;(err as unknown as Record<string, unknown>)['purlType'] = 'hacked'
      }).toThrow()
      expect(() => {
        ;(err as unknown as Record<string, unknown>)['component'] = 'hacked'
      }).toThrow()
    })

    it('should have a frozen prototype', () => {
      expect(Object.isFrozen(PurlInjectionError.prototype)).toBe(true)
    })

    it('should not allow adding new properties to instances', () => {
      const err = getInjectionError(
        () =>
          new PackageURL(
            'cargo',
            undefined,
            'pkg|evil',
            '1.0.0',
            undefined,
            undefined,
          ),
      )
      expect(() => {
        ;(err as unknown as Record<string, unknown>)['newProp'] = 'value'
      }).toThrow()
    })
  })
})
