/**
 * @fileoverview Unit tests for injection character validation in per-type validators.
 * Tests that per-type validate functions reject shell/URL injection characters
 * in name and namespace components across all package ecosystems.
 */
import { describe, expect, it } from 'vitest'

import { PurlError, PurlInjectionError } from '../src/error.js'
import { PackageURL } from '../src/package-url.js'
import {
  containsInjectionCharacters,
  findInjectionCharCode,
  formatInjectionChar,
} from '../src/strings.js'

/** Helper to catch and return a PurlInjectionError for property inspection. */
function getInjectionError(fn: () => unknown): PurlInjectionError {
  let caught: unknown
  try {
    fn()
  } catch (e) {
    caught = e
  }
  expect(caught).toBeInstanceOf(PurlInjectionError)
  return caught as PurlInjectionError
}

// Representative injection characters (subset of what containsInjectionCharacters catches)
const INJECTION_CHARS = ['|', '&', ';', '`', '$']

// Types with namespace support — test both name and namespace injection
const TYPES_WITH_NAMESPACE: Array<{
  type: string
  namespace: string
  name: string
  version?: string
}> = [
  {
    type: 'maven',
    namespace: 'org.example',
    name: 'artifact',
    version: '1.0.0',
  },
  { type: 'github', namespace: 'owner', name: 'repo', version: '1.0.0' },
  { type: 'gitlab', namespace: 'owner', name: 'repo', version: '1.0.0' },
  { type: 'bitbucket', namespace: 'owner', name: 'repo', version: '1.0.0' },
  { type: 'docker', namespace: 'library', name: 'nginx', version: 'latest' },
  {
    type: 'golang',
    namespace: 'github.com/example',
    name: 'pkg',
    version: 'v1.0.0',
  },
  {
    type: 'vscode-extension',
    namespace: 'publisher',
    name: 'ext',
    version: '1.0.0',
  },
  {
    type: 'swift',
    namespace: 'github.com/apple',
    name: 'swift-nio',
    version: '2.0.0',
  },
  { type: 'hex', namespace: 'organization', name: 'phoenix', version: '1.0.0' },
  { type: 'cpan', namespace: 'AUTHOR', name: 'module', version: '1.0.0' },
]

// Types without namespace — test name injection only
const TYPES_WITHOUT_NAMESPACE: Array<{
  type: string
  name: string
  version?: string
}> = [
  { type: 'cargo', name: 'serde', version: '1.0.0' },
  { type: 'gem', name: 'rails', version: '7.0.0' },
  { type: 'nuget', name: 'newtonsoft-json', version: '13.0.1' },
  { type: 'conda', name: 'numpy', version: '1.26.3' },
  { type: 'cocoapods', name: 'alamofire', version: '5.0.0' },
  { type: 'pypi', name: 'requests', version: '2.31.0' },
  { type: 'bazel', name: 'rules-go', version: '0.41.0' },
  { type: 'cran', name: 'ggplot2', version: '3.4.0' },
  { type: 'oci', name: 'myimage', version: '1.0.0' },
  { type: 'opam', name: 'ocaml', version: '5.1.0' },
  { type: 'otp', name: 'cowboy', version: '2.10.0' },
  { type: 'julia', name: 'dataframes', version: '1.5.0' },
  { type: 'mlflow', name: 'mymodel', version: '1.0.0' },
  { type: 'yocto', name: 'zlib', version: '1.2.11' },
]

describe('Per-type injection character validation', () => {
  describe('Name injection rejection across types', () => {
    const allTypes = [
      ...TYPES_WITH_NAMESPACE.map(t => ({
        ...t,
        ns: t.namespace,
      })),
      ...TYPES_WITHOUT_NAMESPACE.map(t => ({
        ...t,
        ns: undefined as string | undefined,
      })),
    ]

    for (const { type, name, ns, version } of allTypes) {
      it(`should reject injection characters in ${type} name`, () => {
        for (const char of INJECTION_CHARS) {
          expect(
            () =>
              new PackageURL(
                type,
                ns,
                `${name}${char}x`,
                version ?? '1.0.0',
                undefined,
                undefined,
              ),
            `${type}: name with ${JSON.stringify(char)}`,
          ).toThrow(PurlError)
        }
      })
    }
  })

  describe('Namespace injection rejection across types', () => {
    for (const { type, namespace, name, version } of TYPES_WITH_NAMESPACE) {
      it(`should reject injection characters in ${type} namespace`, () => {
        for (const char of INJECTION_CHARS) {
          expect(
            () =>
              new PackageURL(
                type,
                `${namespace}${char}x`,
                name,
                version ?? '1.0.0',
                undefined,
                undefined,
              ),
            `${type}: namespace with ${JSON.stringify(char)}`,
          ).toThrow(PurlError)
        }
      })
    }
  })

  describe('Valid names still accepted', () => {
    it('should accept valid package names across types', () => {
      // npm
      expect(
        new PackageURL(
          'npm',
          undefined,
          'lodash',
          '4.17.21',
          undefined,
          undefined,
        ).name,
      ).toBe('lodash')
      // cargo
      expect(
        new PackageURL(
          'cargo',
          undefined,
          'serde',
          '1.0.0',
          undefined,
          undefined,
        ).name,
      ).toBe('serde')
      // maven with namespace
      expect(
        new PackageURL(
          'maven',
          'org.apache',
          'commons-lang3',
          '3.12.0',
          undefined,
          undefined,
        ).name,
      ).toBe('commons-lang3')
      // github with namespace
      expect(
        new PackageURL(
          'github',
          'socketdev',
          'socket-sdk-js',
          '1.0.0',
          undefined,
          undefined,
        ).name,
      ).toBe('socket-sdk-js')
      // docker
      expect(
        new PackageURL(
          'docker',
          'library',
          'nginx',
          'latest',
          undefined,
          undefined,
        ).name,
      ).toBe('nginx')
      // pypi (normalized)
      expect(
        new PackageURL(
          'pypi',
          undefined,
          'requests',
          '2.31.0',
          undefined,
          undefined,
        ).name,
      ).toBe('requests')
    })
  })

  describe('Legitimate version formats are not blocked', () => {
    it('should allow Maven versions with spaces (URL-encoded)', () => {
      const purl = PackageURL.fromString(
        'pkg:maven/mygroup/myartifact@1.0.0%20Final',
      )
      expect(purl.version).toBe('1.0.0 Final')
    })

    it('should allow semver with prerelease and build metadata', () => {
      expect(
        new PackageURL(
          'npm',
          undefined,
          'lodash',
          '4.17.21-beta.1',
          undefined,
          undefined,
        ).version,
      ).toBe('4.17.21-beta.1')
      expect(
        new PackageURL(
          'npm',
          undefined,
          'lodash',
          '4.17.21+build.123',
          undefined,
          undefined,
        ).version,
      ).toBe('4.17.21+build.123')
    })

    it('should allow golang v-prefixed versions', () => {
      expect(
        new PackageURL(
          'golang',
          'github.com/example',
          'pkg',
          'v1.2.3',
          undefined,
          undefined,
        ).version,
      ).toBe('v1.2.3')
    })
  })

  describe('PackageURL.fromString - encoded injection characters', () => {
    it('should reject injection characters that survive URL decoding in name', () => {
      // %7C decodes to |
      expect(() => PackageURL.fromString('pkg:cargo/serde%7Cx@1.0.0')).toThrow(
        PurlError,
      )
      // %26 decodes to &
      expect(() => PackageURL.fromString('pkg:gem/rails%26x@7.0.0')).toThrow(
        PurlError,
      )
    })

    it('should reject injection characters that survive URL decoding in namespace', () => {
      // %7C decodes to |
      expect(() =>
        PackageURL.fromString('pkg:maven/org%7Cevil/artifact@1.0.0'),
      ).toThrow(PurlError)
      // %3B decodes to ;
      expect(() =>
        PackageURL.fromString('pkg:github/owner%3Bx/repo@1.0.0'),
      ).toThrow(PurlError)
    })
  })

  describe('Whitespace injection variants', () => {
    it('should reject space in name', () => {
      expect(
        () =>
          new PackageURL(
            'cargo',
            undefined,
            'my package',
            '1.0.0',
            undefined,
            undefined,
          ),
      ).toThrow(PurlError)
    })

    it('should reject tab in name', () => {
      expect(
        () =>
          new PackageURL(
            'gem',
            undefined,
            'my\tpackage',
            '1.0.0',
            undefined,
            undefined,
          ),
      ).toThrow(PurlError)
    })

    it('should reject newline in name', () => {
      expect(
        () =>
          new PackageURL(
            'nuget',
            undefined,
            'my\npackage',
            '1.0.0',
            undefined,
            undefined,
          ),
      ).toThrow(PurlError)
    })

    it('should reject space in namespace', () => {
      expect(
        () =>
          new PackageURL(
            'maven',
            'org evil',
            'artifact',
            '1.0.0',
            undefined,
            undefined,
          ),
      ).toThrow(PurlError)
    })
  })

  describe('Types requiring special qualifiers', () => {
    it('should reject injection characters in conan name', () => {
      expect(
        () =>
          new PackageURL(
            'conan',
            undefined,
            'zlib|evil',
            '1.2.13',
            undefined,
            undefined,
          ),
      ).toThrow(PurlError)
    })

    it('should reject injection characters in conan namespace', () => {
      expect(
        () =>
          new PackageURL(
            'conan',
            'user|evil',
            'zlib',
            '1.2.13',
            { channel: 'stable' },
            undefined,
          ),
      ).toThrow(PurlError)
    })

    it('should reject injection characters in swid name', () => {
      expect(
        () =>
          new PackageURL(
            'swid',
            undefined,
            'app|evil',
            '1.0.0',
            { tag_id: 'test-tag' },
            undefined,
          ),
      ).toThrow(PurlError)
    })
  })

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
  })

  describe('Hardened scanner - newly detected characters', () => {
    it('should detect single and double quotes', () => {
      expect(containsInjectionCharacters("pkg'name")).toBe(true)
      expect(containsInjectionCharacters('pkg"name')).toBe(true)
    })

    it('should detect control characters (C0 range)', () => {
      // ESC (terminal escape sequences)
      expect(containsInjectionCharacters('pkg\x1bname')).toBe(true)
      // NUL
      expect(containsInjectionCharacters('pkg\x00name')).toBe(true)
      // BEL (terminal bell)
      expect(containsInjectionCharacters('pkg\x07name')).toBe(true)
      // Vertical tab
      expect(containsInjectionCharacters('pkg\x0bname')).toBe(true)
      // Form feed
      expect(containsInjectionCharacters('pkg\x0cname')).toBe(true)
    })

    it('should detect DEL character', () => {
      expect(containsInjectionCharacters('pkg\x7fname')).toBe(true)
    })
  })

  describe('findInjectionCharCode', () => {
    it('should return -1 for clean strings', () => {
      expect(findInjectionCharCode('valid-name')).toBe(-1)
      expect(findInjectionCharCode('my_package.v2')).toBe(-1)
    })

    it('should return the char code of the first injection character', () => {
      expect(findInjectionCharCode('pkg|name')).toBe(0x7c)
      expect(findInjectionCharCode('pkg$name')).toBe(0x24)
      expect(findInjectionCharCode('pkg\x1bname')).toBe(0x1b)
    })
  })

  describe('formatInjectionChar', () => {
    it('should format printable characters with quotes and hex', () => {
      expect(formatInjectionChar(0x7c)).toBe('"|" (0x7c)')
      expect(formatInjectionChar(0x24)).toBe('"$" (0x24)')
      expect(formatInjectionChar(0x20)).toBe('" " (0x20)')
    })

    it('should format control characters as hex only', () => {
      expect(formatInjectionChar(0x00)).toBe('0x00')
      expect(formatInjectionChar(0x1b)).toBe('0x1b')
      expect(formatInjectionChar(0x0a)).toBe('0x0a')
    })

    it('should format DEL as hex only', () => {
      expect(formatInjectionChar(0x7f)).toBe('0x7f')
    })
  })
})
