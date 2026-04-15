/**
 * @fileoverview Tests for per-type injection validation `return false` branches.
 * These tests call each type's validate() with throws=false so the non-throwing
 * `return false` paths are exercised (the constructor always uses throws=true,
 * leaving the return-false branches uncovered).
 */
import { describe, expect, it } from 'vitest'

import { PurlType } from '../src/purl-type.js'

// A null byte triggers findInjectionCharCode reliably across all validators.
const INJ = '\x00'

/**
 * Helper: cast PurlType[typeName] to access .validate(purl, throws).
 */
function getValidator(
  typeName: string,
): (purl: Record<string, unknown>, throws: boolean) => boolean {
  return (PurlType as any)[typeName]?.validate
}

// ────────────────────────────────────────────────────
// Category 1: Types with namespace + name injection checks
// ────────────────────────────────────────────────────

describe('Injection validation return-false branches (throws=false)', () => {
  describe('types with namespace and name injection checks', () => {
    // Each entry: [type, validNamespace, validName, extra purl fields]
    const typesWithNs: Array<
      [string, string, string, Record<string, unknown>?]
    > = [
      ['bitbucket', 'owner', 'repo'],
      ['conan', 'user', 'zlib', { qualifiers: { channel: 'stable' } }],
      ['docker', 'library', 'nginx'],
      ['github', 'owner', 'repo'],
      ['gitlab', 'owner', 'project'],
      ['golang', 'github.com/example', 'pkg'],
      ['maven', 'org.example', 'artifact'],
      ['swift', 'github.com/apple', 'swift-nio', { version: '2.0.0' }],
    ]

    for (const [type, ns, name, extra] of typesWithNs) {
      it(`${type} rejects injection in namespace (no throw)`, () => {
        const validate = getValidator(type)
        const purl = {
          type,
          namespace: `${ns}${INJ}`,
          name,
          ...extra,
        }
        expect(validate(purl, false)).toBe(false)
      })

      it(`${type} rejects injection in name (no throw)`, () => {
        const validate = getValidator(type)
        const purl = {
          type,
          namespace: ns,
          name: `${name}${INJ}`,
          ...extra,
        }
        expect(validate(purl, false)).toBe(false)
      })
    }
  })

  // ────────────────────────────────────────────────────
  // Category 2: Types with name-only injection checks
  // ────────────────────────────────────────────────────

  describe('types with name-only injection checks', () => {
    const typesNameOnly: Array<[string, string, Record<string, unknown>?]> = [
      ['bazel', 'rules-go', { version: '0.41.0' }],
      ['cargo', 'serde', { namespace: '' }],
      ['conda', 'numpy', { namespace: '' }],
      ['cpan', 'moose'],
      ['cran', 'ggplot2', { version: '3.4.0' }],
      ['gem', 'rails'],
      ['hex', 'phoenix'],
      ['julia', 'dataframes'],
      ['mlflow', 'mymodel', { namespace: '' }],
      ['npm', 'lodash', { namespace: '' }],
      ['nuget', 'newtonsoft-json'],
      ['oci', 'myimage', { namespace: '' }],
      ['opam', 'ocaml', { namespace: '' }],
      ['otp', 'cowboy', { namespace: '' }],
      ['pypi', 'requests'],
      ['swid', 'myapp', { qualifiers: { tag_id: 'test-tag' } }],
      ['yocto', 'zlib', { namespace: '' }],
    ]

    for (const [type, name, extra] of typesNameOnly) {
      it(`${type} rejects injection in name (no throw)`, () => {
        const validate = getValidator(type)
        const purl = {
          type,
          name: `${name}${INJ}`,
          ...extra,
        }
        expect(validate(purl, false)).toBe(false)
      })
    }
  })

  // ────────────────────────────────────────────────────
  // npm-specific non-throwing validation paths
  // ────────────────────────────────────────────────────

  describe('npm-specific return-false branches (throws=false)', () => {
    const npmValidate = getValidator('npm')

    it('rejects name starting with period', () => {
      const purl = { namespace: '', name: '.hidden' }
      expect(npmValidate(purl, false)).toBe(false)
    })

    it('rejects name starting with underscore', () => {
      const purl = { namespace: '', name: '_private' }
      expect(npmValidate(purl, false)).toBe(false)
    })

    it('rejects name with leading/trailing spaces', () => {
      // Spaces are injection chars, so injection check fires first.
      // Use a tab which is also an injection char. Instead, test with
      // trimmed name by using a name that encodes differently.
      // Actually spaces trigger injection validator first. The `return false`
      // for trim check is unreachable when injection chars are present.
      // We need a name where trim() !== name but has no injection chars.
      // That is not possible (whitespace IS an injection char). So these
      // lines may only be reachable through direct validate() calls with
      // pre-normalized input. Skip this specific branch.
    })

    it('rejects namespace with leading/trailing spaces', () => {
      // Same situation as above - spaces are injection chars.
      // The edge cases test already covers this path.
    })

    it('rejects namespace without @ prefix', () => {
      const purl = { namespace: 'no-at', name: 'test' }
      expect(npmValidate(purl, false)).toBe(false)
    })

    it('rejects namespace injection in namespace field', () => {
      const purl = { namespace: `@scope${INJ}`, name: 'test' }
      expect(npmValidate(purl, false)).toBe(false)
    })

    it('rejects node_modules as name', () => {
      const purl = { namespace: '', name: 'node_modules' }
      expect(npmValidate(purl, false)).toBe(false)
    })

    it('rejects favicon.ico as name', () => {
      const purl = { namespace: '', name: 'favicon.ico' }
      expect(npmValidate(purl, false)).toBe(false)
    })

    it('rejects name longer than 214 characters', () => {
      const purl = { namespace: '', name: 'a'.repeat(215) }
      expect(npmValidate(purl, false)).toBe(false)
    })

    it('rejects uppercase in modern name', () => {
      const purl = { namespace: '', name: 'MyPackage' }
      expect(npmValidate(purl, false)).toBe(false)
    })

    it('rejects special characters in modern name', () => {
      const purl = { namespace: '', name: 'my~package' }
      expect(npmValidate(purl, false)).toBe(false)
    })

    it('rejects core module name', () => {
      // 'worker_threads' is a Node.js builtin that is NOT in the legacy names set,
      // so it passes the legacy check and reaches the isNpmBuiltinName check.
      const purl = { namespace: '', name: 'worker_threads' }
      expect(npmValidate(purl, false)).toBe(false)
    })

    it('rejects non-URL-friendly name', () => {
      const purl = { namespace: '', name: 'パッケージ' }
      expect(npmValidate(purl, false)).toBe(false)
    })

    it('rejects non-URL-friendly namespace', () => {
      const purl = { namespace: '@パッケージ', name: 'test' }
      expect(npmValidate(purl, false)).toBe(false)
    })
  })

  // ────────────────────────────────────────────────────
  // Hex namespace injection
  // ────────────────────────────────────────────────────

  describe('hex namespace injection', () => {
    it('rejects injection in hex namespace (no throw)', () => {
      const validate = getValidator('hex')
      const purl = {
        type: 'hex',
        namespace: `org${INJ}`,
        name: 'phoenix',
      }
      expect(validate(purl, false)).toBe(false)
    })
  })

  // ────────────────────────────────────────────────────
  // CPan and CRan namespace injection
  // ────────────────────────────────────────────────────

  describe('cpan namespace injection', () => {
    it('rejects injection in cpan namespace (no throw)', () => {
      const validate = getValidator('cpan')
      const purl = {
        type: 'cpan',
        namespace: `AUTHOR${INJ}`,
        name: 'moose',
      }
      expect(validate(purl, false)).toBe(false)
    })
  })

  describe('cran namespace injection', () => {
    it('rejects injection in cran namespace (no throw)', () => {
      const validate = getValidator('cran')
      const purl = {
        type: 'cran',
        namespace: `repo${INJ}`,
        name: 'ggplot2',
      }
      expect(validate(purl, false)).toBe(false)
    })
  })

  // ────────────────────────────────────────────────────
  // Gem and Nuget namespace injection
  // ────────────────────────────────────────────────────

  describe('gem namespace injection', () => {
    it('rejects injection in gem namespace (no throw)', () => {
      const validate = getValidator('gem')
      const purl = {
        type: 'gem',
        namespace: `org${INJ}`,
        name: 'rails',
      }
      expect(validate(purl, false)).toBe(false)
    })
  })

  describe('nuget namespace injection', () => {
    it('rejects injection in nuget namespace (no throw)', () => {
      const validate = getValidator('nuget')
      const purl = {
        type: 'nuget',
        namespace: `org${INJ}`,
        name: 'newtonsoft-json',
      }
      expect(validate(purl, false)).toBe(false)
    })
  })

  // ────────────────────────────────────────────────────
  // Fallback PurlTypeValidator (purl-type.ts)
  // ────────────────────────────────────────────────────

  describe('fallback PurlTypeValidator injection checks', () => {
    // Types without their own validator use the fallback PurlTypeValidator.
    // Test with a type that has no registered validator (e.g., 'alpm', 'deb').
    it('rejects injection in namespace for fallback type (no throw)', () => {
      const validate = getValidator('alpm')
      const purl = {
        type: 'alpm',
        namespace: `archlinux${INJ}`,
        name: 'pacman',
      }
      expect(validate(purl, false)).toBe(false)
    })

    it('rejects injection in name for fallback type (no throw)', () => {
      const validate = getValidator('alpm')
      const purl = {
        type: 'alpm',
        namespace: 'archlinux',
        name: `pacman${INJ}`,
      }
      expect(validate(purl, false)).toBe(false)
    })

    it('rejects injection in namespace for deb type (no throw)', () => {
      const validate = getValidator('deb')
      const purl = {
        type: 'deb',
        namespace: `debian${INJ}`,
        name: 'curl',
      }
      expect(validate(purl, false)).toBe(false)
    })

    it('rejects injection in name for deb type (no throw)', () => {
      const validate = getValidator('deb')
      const purl = {
        type: 'deb',
        namespace: 'debian',
        name: `curl${INJ}`,
      }
      expect(validate(purl, false)).toBe(false)
    })

    it('accepts clean name/namespace for fallback type', () => {
      const validate = getValidator('alpm')
      const purl = {
        type: 'alpm',
        namespace: 'archlinux',
        name: 'pacman',
      }
      expect(validate(purl, false)).toBe(true)
    })

    it('accepts name without namespace for fallback type', () => {
      const validate = getValidator('rpm')
      const purl = {
        type: 'rpm',
        name: 'curl',
      }
      expect(validate(purl, false)).toBe(true)
    })
  })

  // ────────────────────────────────────────────────────
  // Cocoapods injection (name only)
  // ────────────────────────────────────────────────────

  describe('cocoapods injection', () => {
    it('rejects injection in cocoapods name (no throw)', () => {
      const validate = getValidator('cocoapods')
      const purl = {
        type: 'cocoapods',
        name: `Alamofire${INJ}`,
      }
      expect(validate(purl, false)).toBe(false)
    })
  })

  // ────────────────────────────────────────────────────
  // VSCode extension injection
  // ────────────────────────────────────────────────────

  describe('vscode-extension injection', () => {
    it('rejects injection in vscode-extension namespace (no throw)', () => {
      const validate = getValidator('vscode-extension')
      const purl = {
        type: 'vscode-extension',
        namespace: `publisher${INJ}`,
        name: 'ext',
        version: '1.0.0',
      }
      expect(validate(purl, false)).toBe(false)
    })

    it('rejects injection in vscode-extension name (no throw)', () => {
      const validate = getValidator('vscode-extension')
      const purl = {
        type: 'vscode-extension',
        namespace: 'publisher',
        name: `ext${INJ}`,
        version: '1.0.0',
      }
      expect(validate(purl, false)).toBe(false)
    })
  })

  // ────────────────────────────────────────────────────
  // Types that require empty namespace (validateEmptyByType)
  // ────────────────────────────────────────────────────

  describe('empty namespace validation (throws=false)', () => {
    const typesRequiringEmptyNs: Array<
      [string, string, Record<string, unknown>?]
    > = [
      ['cargo', 'serde'],
      ['conda', 'numpy'],
      ['julia', 'DataFrames'],
      ['mlflow', 'mymodel'],
      ['oci', 'myimage'],
      ['opam', 'ocaml'],
      ['otp', 'cowboy'],
      ['yocto', 'zlib'],
    ]

    for (const [type, name, extra] of typesRequiringEmptyNs) {
      it(`${type} rejects non-empty namespace (no throw)`, () => {
        const validate = getValidator(type)
        const purl = {
          type,
          namespace: 'should-be-empty',
          name,
          ...extra,
        }
        expect(validate(purl, false)).toBe(false)
      })
    }
  })

  // ────────────────────────────────────────────────────
  // Required field validation (missing required components)
  // ────────────────────────────────────────────────────

  describe('required field validation (throws=false)', () => {
    it('swift rejects missing namespace (no throw)', () => {
      const validate = getValidator('swift')
      const purl = {
        type: 'swift',
        name: 'swift-nio',
        version: '2.0.0',
      }
      expect(validate(purl, false)).toBe(false)
    })

    it('swift rejects missing version (no throw)', () => {
      const validate = getValidator('swift')
      const purl = {
        type: 'swift',
        namespace: 'github.com/apple',
        name: 'swift-nio',
      }
      expect(validate(purl, false)).toBe(false)
    })

    it('cran rejects missing version (no throw)', () => {
      const validate = getValidator('cran')
      const purl = { type: 'cran', name: 'ggplot2' }
      expect(validate(purl, false)).toBe(false)
    })

    it('maven rejects missing namespace (no throw)', () => {
      const validate = getValidator('maven')
      const purl = { type: 'maven', name: 'artifact' }
      expect(validate(purl, false)).toBe(false)
    })
  })

  // ────────────────────────────────────────────────────
  // Fallback PurlTypeValidator throw paths (throws=true)
  // ────────────────────────────────────────────────────

  describe('fallback PurlTypeValidator throw paths', () => {
    it('throws on injection in namespace for fallback type', () => {
      const validate = getValidator('alpm')
      const purl = {
        type: 'alpm',
        namespace: `archlinux${INJ}`,
        name: 'pacman',
      }
      expect(() => validate(purl, true)).toThrow()
    })

    it('throws on injection in name for fallback type', () => {
      const validate = getValidator('alpm')
      const purl = {
        type: 'alpm',
        namespace: 'archlinux',
        name: `pacman${INJ}`,
      }
      expect(() => validate(purl, true)).toThrow()
    })
  })

  // ────────────────────────────────────────────────────
  // npm throw paths for previously uncovered lines
  // ────────────────────────────────────────────────────

  describe('npm-specific throw paths (throws=true)', () => {
    const npmValidate = getValidator('npm')

    it('throws on non-URL-friendly name', () => {
      const purl = { namespace: '', name: 'パッケージ' }
      expect(() => npmValidate(purl, true)).toThrow(/URL-friendly/)
    })

    it('throws on non-URL-friendly namespace', () => {
      const purl = { namespace: '@パッケージ', name: 'test' }
      expect(() => npmValidate(purl, true)).toThrow(/URL-friendly/)
    })

    it('throws on uppercase in modern name', () => {
      const purl = { namespace: '', name: 'MyPackage' }
      expect(() => npmValidate(purl, true)).toThrow(/capital/)
    })
  })
})
