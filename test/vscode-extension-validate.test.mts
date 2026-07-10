/**
 * @file Tests for vscode-extension purl-type validate + normalize behavior,
 *   including PackageURL construction and fromString parsing.
 */
import { describe, expect, it } from 'vitest'

import { PurlError } from '../src/error.mjs'
import { PackageURL } from '../src/package-url.mjs'
import { validate as validateVscodeExtension } from '../src/purl-types/vscode-extension.mjs'

describe('vscode-extension validate + normalize', () => {
  describe('validate', () => {
    it('should accept spec-compliant PURLs', () => {
      expect(
        validateVscodeExtension(
          {
            name: 'python',
            namespace: 'ms-python',
            version: '2023.25.10292213',
          },
          { throws: false },
        ),
      ).toBe(true)
      expect(
        validateVscodeExtension(
          { name: 'java', namespace: 'redhat', version: '1.46.2025091308' },
          { throws: false },
        ),
      ).toBe(true)
      expect(
        validateVscodeExtension(
          { name: 'go', namespace: 'golang', version: '0.39.1' },
          { throws: false },
        ),
      ).toBe(true)
    })

    it('should accept PURLs without version', () => {
      expect(
        validateVscodeExtension(
          { name: 'java', namespace: 'redhat' },
          { throws: false },
        ),
      ).toBe(true)
    })

    it('should accept valid platform qualifiers', () => {
      const platforms = [
        'universal',
        'linux-x64',
        'linux-arm64',
        'darwin-x64',
        'darwin-arm64',
        'win32-x64',
        'win32-arm64',
      ]
      for (let i = 0, { length } = platforms; i < length; i += 1) {
        const platform = platforms[i]
        expect(
          validateVscodeExtension(
            {
              name: 'python',
              namespace: 'ms-python',
              qualifiers: { platform },
            },
            { throws: false },
          ),
        ).toBe(true)
      }
    })

    it('should accept valid semver versions', () => {
      expect(
        validateVscodeExtension(
          { name: 'python', namespace: 'ms-python', version: '1.0.0' },
          { throws: false },
        ),
      ).toBe(true)
      expect(
        validateVscodeExtension(
          { name: 'python', namespace: 'ms-python', version: '0.3.0-beta.1' },
          { throws: false },
        ),
      ).toBe(true)
      expect(
        validateVscodeExtension(
          {
            name: 'python',
            namespace: 'ms-python',
            version: '1.0.0+build123',
          },
          { throws: false },
        ),
      ).toBe(true)
    })

    it('should require namespace (publisher)', () => {
      expect(
        validateVscodeExtension({ name: 'python' }, { throws: false }),
      ).toBe(false)
      expect(() =>
        validateVscodeExtension({ name: 'python' }, { throws: true }),
      ).toThrow(PurlError)
    })

    it('should reject illegal characters in namespace', () => {
      const illegal = ['ns|x', 'ns&x', 'ns;x', 'ns`x`', 'ns$(x)', 'ns x']
      for (let i = 0, { length } = illegal; i < length; i += 1) {
        const namespace = illegal[i]
        expect(
          validateVscodeExtension(
            { name: 'ext', namespace },
            { throws: false },
          ),
        ).toBe(false)
      }
      expect(() =>
        validateVscodeExtension(
          { name: 'ext', namespace: 'ns|x' },
          { throws: true },
        ),
      ).toThrow(PurlError)
    })

    it('should reject illegal characters in name', () => {
      const illegal = ['ext|x', 'ext&x', 'ext;x', 'ext<x>', 'ext{x}']
      for (let i = 0, { length } = illegal; i < length; i += 1) {
        const name = illegal[i]
        expect(
          validateVscodeExtension(
            { name, namespace: 'ms-python' },
            { throws: false },
          ),
        ).toBe(false)
      }
      expect(() =>
        validateVscodeExtension(
          { name: 'ext|x', namespace: 'ms-python' },
          { throws: true },
        ),
      ).toThrow(PurlError)
    })

    it('should reject non-semver version strings', () => {
      const invalid = ['not-semver', 'latest', '1.0', '1']
      for (let i = 0, { length } = invalid; i < length; i += 1) {
        const version = invalid[i]
        expect(
          validateVscodeExtension(
            { name: 'python', namespace: 'ms-python', version },
            { throws: false },
          ),
        ).toBe(false)
      }
      expect(() =>
        validateVscodeExtension(
          { name: 'python', namespace: 'ms-python', version: 'latest' },
          { throws: true },
        ),
      ).toThrow(PurlError)
    })

    it('should reject illegal characters in platform qualifier', () => {
      const illegal = ['linux x64', 'linux|x64', 'linux&x64', 'linux;x64']
      for (let i = 0, { length } = illegal; i < length; i += 1) {
        const platform = illegal[i]
        expect(
          validateVscodeExtension(
            {
              name: 'python',
              namespace: 'ms-python',
              qualifiers: { platform },
            },
            { throws: false },
          ),
        ).toBe(false)
      }
      expect(() =>
        validateVscodeExtension(
          {
            name: 'python',
            namespace: 'ms-python',
            qualifiers: { platform: 'linux|x64' },
          },
          { throws: true },
        ),
      ).toThrow(PurlError)
    })
  })

  describe('normalize', () => {
    it('should lowercase namespace, name, and version per spec', () => {
      const purl = PackageURL.fromString(
        'pkg:vscode-extension/MS-Python/Python@1.0.0-BETA',
      )
      expect(purl.namespace).toBe('ms-python')
      expect(purl.name).toBe('python')
      expect(purl.version).toBe('1.0.0-beta')
    })
  })

  describe('PackageURL construction', () => {
    it('should construct valid vscode-extension PURLs', () => {
      const purl = new PackageURL(
        'vscode-extension',
        'ms-python',
        'python',
        '1.0.0',
        undefined,
        undefined,
      )
      expect(purl.type).toBe('vscode-extension')
      expect(purl.namespace).toBe('ms-python')
      expect(purl.name).toBe('python')
      expect(purl.version).toBe('1.0.0')
    })

    it('should reject illegal characters in namespace during construction', () => {
      expect(
        () =>
          new PackageURL(
            'vscode-extension',
            'pub|x',
            'ext',
            '1.0.0',
            undefined,
            undefined,
          ),
      ).toThrow(PurlError)
    })

    it('should reject illegal characters in name during construction', () => {
      expect(
        () =>
          new PackageURL(
            'vscode-extension',
            'publisher',
            'ext&x',
            '1.0.0',
            undefined,
            undefined,
          ),
      ).toThrow(PurlError)
    })

    it('should reject non-semver version during construction', () => {
      expect(
        () =>
          new PackageURL(
            'vscode-extension',
            'publisher',
            'ext',
            'not-a-version',
            undefined,
            undefined,
          ),
      ).toThrow(PurlError)
    })

    it('should reject illegal characters in platform qualifier during construction', () => {
      expect(
        () =>
          new PackageURL(
            'vscode-extension',
            'publisher',
            'ext',
            '1.0.0',
            { platform: 'linux|x64' },
            undefined,
          ),
      ).toThrow(PurlError)
    })
  })

  describe('PackageURL.fromString', () => {
    it('should parse spec-compliant PURL strings', () => {
      const purl = PackageURL.fromString(
        'pkg:vscode-extension/ms-python/python@2023.25.10292213',
      )
      expect(purl.type).toBe('vscode-extension')
      expect(purl.namespace).toBe('ms-python')
      expect(purl.name).toBe('python')
      expect(purl.version).toBe('2023.25.10292213')
    })

    it('should parse PURL with platform qualifier', () => {
      const purl = PackageURL.fromString(
        'pkg:vscode-extension/golang/go@0.39.1?platform=win32-x64',
      )
      expect(purl.qualifiers).toEqual({ platform: 'win32-x64' })
    })

    it('should reject encoded illegal characters in version', () => {
      // %26 decodes to &, which is not valid in a semver version
      expect(() =>
        PackageURL.fromString('pkg:vscode-extension/publisher/ext@1.0.0%26x'),
      ).toThrow(PurlError)
    })

    it('should reject encoded illegal characters in namespace', () => {
      // %7C decodes to |, which is not a valid publisher character
      expect(() =>
        PackageURL.fromString('pkg:vscode-extension/%7Cx/ext@1.0.0'),
      ).toThrow(PurlError)
    })
  })
})
