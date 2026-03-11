/*!
Copyright (c) the purl authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

/**
 * @fileoverview Unit tests for type-specific PackageURL behavior.
 * Tests package-type-specific normalizations and validations for npm (legacy names, builtins),
 * pub (dash-to-underscore), and pypi (lowercase, underscore-to-dash) package types.
 */
import { describe, expect, it } from 'vitest'

import npmBuiltinNames from '../data/npm/builtin-names.json'
import npmLegacyNames from '../data/npm/legacy-names.json'
import { PackageURL } from '../src/package-url.js'
import { validate as validateBazel } from '../src/purl-types/bazel.js'

function getNpmId(purl: any) {
  const { name, namespace } = purl
  return `${namespace?.length > 0 ? `${namespace}/` : ''}${name}`
}

describe('PackageURL type-specific tests', () => {
  describe('npm', () => {
    it("should allow legacy names to be mixed case, match a builtin, or contain ~'!()* characters", () => {
      // Tests npm legacy package exceptions (historical packages with special names)
      for (const legacyName of npmLegacyNames) {
        let purl: PackageURL | undefined
        expect(() => {
          const parts = legacyName.split('/')
          const namespace = parts.length > 1 ? parts[0] : ''
          const name = parts.at(-1)
          purl = new PackageURL(
            'npm',
            namespace,
            name,
            undefined,
            undefined,
            undefined,
          )
        }).not.toThrow()
        const id = purl ? getNpmId(purl) : ''
        const isBuiltin = npmBuiltinNames.includes(id)
        const isMixedCased = /[A-Z]/.test(id)
        const containsIllegalCharacters = /[~'!()*]/.test(id)
        expect(
          isBuiltin || isMixedCased || containsIllegalCharacters,
          `assert for ${legacyName}`,
        ).toBe(true)
      }
    })

    it('should not allow non-legacy builtin names', () => {
      // Tests npm builtin module validation (only legacy builtins allowed)
      for (const builtinName of npmBuiltinNames) {
        if (!npmLegacyNames.includes(builtinName)) {
          expect(() => {
            const parts = builtinName.split('/')
            const namespace = parts.length > 1 ? parts[0] : ''
            const name = parts.at(-1)

            return new PackageURL(
              'npm',
              namespace,
              name,
              undefined,
              undefined,
              undefined,
            )
          }, `assert for ${builtinName}`).toThrow()
        }
      }
    })
  })

  describe('pub', () => {
    it('should normalize dashes to underscores', () => {
      // Tests pub-specific normalization (dashes to underscores per spec)
      const purlWithDashes = new PackageURL(
        'pub',
        '',
        'flutter-downloader',
        '1.0.0',
        undefined,
        undefined,
      )
      expect(purlWithDashes.toString()).toBe('pkg:pub/flutter_downloader@1.0.0')
    })
  })

  describe('pypi', () => {
    it('should handle pypi package-urls per the purl-spec', () => {
      // Tests PyPI-specific normalizations (lowercase, underscores to dashes)
      const purlMixedCasing = PackageURL.fromString('pkg:pypi/PYYaml@5.3.0')
      expect(purlMixedCasing.toString()).toBe('pkg:pypi/pyyaml@5.3.0')
      const purlWithUnderscore = PackageURL.fromString(
        'pkg:pypi/typing_extensions_blah@1.0.0',
      )
      expect(purlWithUnderscore.toString()).toBe(
        'pkg:pypi/typing-extensions-blah@1.0.0',
      )
    })
  })

  describe('cargo', () => {
    it('should reject cargo packages with namespace', () => {
      // Cargo does not support namespace per spec
      expect(() => {
        return new PackageURL(
          'cargo',
          'some-namespace',
          'rand',
          '0.7.2',
          undefined,
          undefined,
        )
      }).toThrow('cargo "namespace" component must be empty')
    })

    it('should accept cargo packages without namespace', () => {
      const purl = new PackageURL(
        'cargo',
        undefined,
        'rand',
        '0.7.2',
        undefined,
        undefined,
      )
      expect(purl.toString()).toBe('pkg:cargo/rand@0.7.2')
    })

    it('should preserve case in cargo package names', () => {
      // Cargo names are case-sensitive
      const purl = new PackageURL(
        'cargo',
        undefined,
        'MyPackage',
        '1.0.0',
        undefined,
        undefined,
      )
      expect(purl.name).toBe('MyPackage')
      expect(purl.toString()).toBe('pkg:cargo/MyPackage@1.0.0')
    })
  })

  describe('gem', () => {
    it('should reject gem packages with namespace', () => {
      // RubyGems does not support namespace per spec
      expect(() => {
        return new PackageURL(
          'gem',
          'some-namespace',
          'rails',
          '7.0.0',
          undefined,
          undefined,
        )
      }).toThrow('gem "namespace" component must be empty')
    })

    it('should accept gem packages without namespace', () => {
      const purl = new PackageURL(
        'gem',
        undefined,
        'rails',
        '7.0.0',
        undefined,
        undefined,
      )
      expect(purl.toString()).toBe('pkg:gem/rails@7.0.0')
    })

    it('should preserve case in gem package names', () => {
      // Gem names are case-sensitive
      const purl = new PackageURL(
        'gem',
        undefined,
        'MyGem',
        '1.0.0',
        undefined,
        undefined,
      )
      expect(purl.name).toBe('MyGem')
      expect(purl.toString()).toBe('pkg:gem/MyGem@1.0.0')
    })
  })

  describe('nuget', () => {
    it('should reject nuget packages with namespace', () => {
      // NuGet does not support namespace per spec
      expect(() => {
        return new PackageURL(
          'nuget',
          'some-namespace',
          'Newtonsoft.Json',
          '13.0.1',
          undefined,
          undefined,
        )
      }).toThrow('nuget "namespace" component must be empty')
    })

    it('should accept nuget packages without namespace', () => {
      const purl = new PackageURL(
        'nuget',
        undefined,
        'Newtonsoft.Json',
        '13.0.1',
        undefined,
        undefined,
      )
      expect(purl.toString()).toBe('pkg:nuget/Newtonsoft.Json@13.0.1')
    })

    it('should preserve case in nuget package names', () => {
      // NuGet names are case-preserving but case-insensitive (no normalization)
      const purl = new PackageURL(
        'nuget',
        undefined,
        'Newtonsoft.Json',
        '13.0.1',
        undefined,
        undefined,
      )
      expect(purl.name).toBe('Newtonsoft.Json')
      expect(purl.toString()).toBe('pkg:nuget/Newtonsoft.Json@13.0.1')
    })
  })

  describe('bazel', () => {
    it('should require version for bazel packages', () => {
      expect(() => {
        return new PackageURL(
          'bazel',
          undefined,
          'rules_go',
          undefined,
          undefined,
          undefined,
        )
      }).toThrow('bazel requires a "version" component')
    })

    it('should accept bazel packages with version', () => {
      const purl = new PackageURL(
        'bazel',
        undefined,
        'rules_go',
        '0.41.0',
        undefined,
        undefined,
      )
      expect(purl.toString()).toBe('pkg:bazel/rules_go@0.41.0')
    })

    it('should lowercase bazel package names', () => {
      const purl = new PackageURL(
        'bazel',
        undefined,
        'RulesGo',
        '0.41.0',
        undefined,
        undefined,
      )
      expect(purl.name).toBe('rulesgo')
      expect(purl.toString()).toBe('pkg:bazel/rulesgo@0.41.0')
    })

    it('should return false when validation fails without throws', () => {
      // Test validate function directly with throws: false
      const invalidPurl = { name: 'rules_go', type: 'bazel' }
      expect(validateBazel(invalidPurl, false)).toBe(false)
    })
  })

  describe('conda', () => {
    it('should reject conda packages with namespace', () => {
      expect(() => {
        return new PackageURL(
          'conda',
          'some-namespace',
          'numpy',
          '1.26.3',
          undefined,
          undefined,
        )
      }).toThrow('conda "namespace" component must be empty')
    })

    it('should accept conda packages without namespace', () => {
      const purl = new PackageURL(
        'conda',
        undefined,
        'numpy',
        '1.26.3',
        undefined,
        undefined,
      )
      expect(purl.toString()).toBe('pkg:conda/numpy@1.26.3')
    })

    it('should lowercase conda package names', () => {
      const purl = new PackageURL(
        'conda',
        undefined,
        'NumPy',
        '1.26.3',
        undefined,
        undefined,
      )
      expect(purl.name).toBe('numpy')
      expect(purl.toString()).toBe('pkg:conda/numpy@1.26.3')
    })
  })

  describe('julia', () => {
    it('should reject julia packages with namespace', () => {
      expect(() => {
        return new PackageURL(
          'julia',
          'some-namespace',
          'DataFrames',
          '1.5.0',
          undefined,
          undefined,
        )
      }).toThrow('julia "namespace" component must be empty')
    })

    it('should accept julia packages without namespace', () => {
      const purl = new PackageURL(
        'julia',
        undefined,
        'DataFrames',
        '1.5.0',
        undefined,
        undefined,
      )
      expect(purl.toString()).toBe('pkg:julia/DataFrames@1.5.0')
    })

    it('should preserve case in julia package names', () => {
      // Julia names are case-sensitive (typically CamelCase)
      const purl = new PackageURL(
        'julia',
        undefined,
        'DataFrames',
        '1.5.0',
        undefined,
        undefined,
      )
      expect(purl.name).toBe('DataFrames')
      expect(purl.toString()).toBe('pkg:julia/DataFrames@1.5.0')
    })
  })

  describe('opam', () => {
    it('should reject opam packages with namespace', () => {
      expect(() => {
        return new PackageURL(
          'opam',
          'some-namespace',
          'ocaml',
          '5.1.0',
          undefined,
          undefined,
        )
      }).toThrow('opam "namespace" component must be empty')
    })

    it('should accept opam packages without namespace', () => {
      const purl = new PackageURL(
        'opam',
        undefined,
        'ocaml',
        '5.1.0',
        undefined,
        undefined,
      )
      expect(purl.toString()).toBe('pkg:opam/ocaml@5.1.0')
    })
  })

  describe('otp', () => {
    it('should reject otp packages with namespace', () => {
      expect(() => {
        return new PackageURL(
          'otp',
          'some-namespace',
          'cowboy',
          '2.10.0',
          undefined,
          undefined,
        )
      }).toThrow('otp "namespace" component must be empty')
    })

    it('should accept otp packages without namespace', () => {
      const purl = new PackageURL(
        'otp',
        undefined,
        'cowboy',
        '2.10.0',
        undefined,
        undefined,
      )
      expect(purl.toString()).toBe('pkg:otp/cowboy@2.10.0')
    })

    it('should lowercase otp package names', () => {
      const purl = new PackageURL(
        'otp',
        undefined,
        'CowBoy',
        '2.10.0',
        undefined,
        undefined,
      )
      expect(purl.name).toBe('cowboy')
      expect(purl.toString()).toBe('pkg:otp/cowboy@2.10.0')
    })
  })

  describe('yocto', () => {
    it('should reject yocto packages with namespace', () => {
      expect(() => {
        return new PackageURL(
          'yocto',
          'some-namespace',
          'zlib',
          '1.2.11',
          undefined,
          undefined,
        )
      }).toThrow('yocto "namespace" component must be empty')
    })

    it('should accept yocto packages without namespace', () => {
      const purl = new PackageURL(
        'yocto',
        undefined,
        'zlib',
        '1.2.11',
        undefined,
        undefined,
      )
      expect(purl.toString()).toBe('pkg:yocto/zlib@1.2.11')
    })

    it('should lowercase yocto package names', () => {
      const purl = new PackageURL(
        'yocto',
        undefined,
        'ZLib',
        '1.2.11',
        undefined,
        undefined,
      )
      expect(purl.name).toBe('zlib')
      expect(purl.toString()).toBe('pkg:yocto/zlib@1.2.11')
    })
  })

  describe('docker', () => {
    it('should lowercase docker image names', () => {
      const purl = new PackageURL(
        'docker',
        'library',
        'Nginx',
        'latest',
        undefined,
        undefined,
      )
      expect(purl.name).toBe('nginx')
      expect(purl.toString()).toBe('pkg:docker/library/nginx@latest')
    })

    it('should preserve namespace case for registry hosts', () => {
      const purl = new PackageURL(
        'docker',
        'MyRegistry.io',
        'myapp',
        'v1.0',
        undefined,
        undefined,
      )
      expect(purl.namespace).toBe('MyRegistry.io')
      expect(purl.toString()).toBe('pkg:docker/MyRegistry.io/myapp@v1.0')
    })
  })

  describe('vscode-extension', () => {
    it('should lowercase both namespace and name', () => {
      const purl = new PackageURL(
        'vscode-extension',
        'Microsoft',
        'VSCode-ESLint',
        '2.4.2',
        undefined,
        undefined,
      )
      expect(purl.namespace).toBe('microsoft')
      expect(purl.name).toBe('vscode-eslint')
      expect(purl.toString()).toBe(
        'pkg:vscode-extension/microsoft/vscode-eslint@2.4.2',
      )
    })
  })

  describe('generic', () => {
    it('should accept generic packages with any components', () => {
      const purl = new PackageURL(
        'generic',
        'some-namespace',
        'some-name',
        '1.0.0',
        undefined,
        undefined,
      )
      expect(purl.toString()).toBe('pkg:generic/some-namespace/some-name@1.0.0')
    })

    it('should not normalize generic package names', () => {
      const purl = new PackageURL(
        'generic',
        'MyNamespace',
        'MyPackage',
        '1.0.0',
        undefined,
        undefined,
      )
      expect(purl.namespace).toBe('MyNamespace')
      expect(purl.name).toBe('MyPackage')
    })
  })

  describe('socket', () => {
    it('should accept socket packages', () => {
      const purl = new PackageURL(
        'socket',
        undefined,
        'package-name',
        '1.0.0',
        undefined,
        undefined,
      )
      expect(purl.toString()).toBe('pkg:socket/package-name@1.0.0')
    })

    it('should not normalize socket package names', () => {
      const purl = new PackageURL(
        'socket',
        undefined,
        'MyPackage',
        '1.0.0',
        undefined,
        undefined,
      )
      expect(purl.name).toBe('MyPackage')
    })
  })

  describe('unknown', () => {
    it('should accept unknown packages', () => {
      const purl = new PackageURL(
        'unknown',
        undefined,
        'package-name',
        '1.0.0',
        undefined,
        undefined,
      )
      expect(purl.toString()).toBe('pkg:unknown/package-name@1.0.0')
    })

    it('should not normalize unknown package names', () => {
      const purl = new PackageURL(
        'unknown',
        undefined,
        'MyPackage',
        '1.0.0',
        undefined,
        undefined,
      )
      expect(purl.name).toBe('MyPackage')
    })
  })
})
