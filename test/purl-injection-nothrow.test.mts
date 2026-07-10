/* max-file-lines: table -- per-type return-false branch matrix; splitting would scatter category coverage across files. */
/**
 * @file Tests for per-type injection validation `return false` branches. These
 *   tests call each type's validate() with throws=false so the non-throwing
 *   `return false` paths are exercised (the constructor always uses
 *   throws=true, leaving the return-false branches uncovered).
 */
import { describe, expect, it } from 'vitest'

import { PurlType } from '../src/purl-type.mjs'

// A null byte triggers findInjectionCharCode reliably across all validators.
const INJ = '\x00'

type PurlTypeValidators = Record<
  string,
  | {
      readonly validate: (
        purl: Record<string, unknown>,
        options?: { throws?: boolean | undefined } | undefined,
      ) => boolean
    }
  | undefined
>
const PurlTypeT = PurlType as unknown as PurlTypeValidators

/**
 * Helper: read PurlType[typeName].validate(purl, throws).
 */
export function getValidator(
  typeName: string,
): (
  purl: Record<string, unknown>,
  options?: { throws?: boolean | undefined } | undefined,
) => boolean {
  return PurlTypeT[typeName]!.validate
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
        expect(validate(purl, { throws: false })).toBe(false)
      })

      it(`${type} rejects injection in name (no throw)`, () => {
        const validate = getValidator(type)
        const purl = {
          type,
          namespace: ns,
          name: `${name}${INJ}`,
          ...extra,
        }
        expect(validate(purl, { throws: false })).toBe(false)
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
        expect(validate(purl, { throws: false })).toBe(false)
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
      expect(npmValidate(purl, { throws: false })).toBe(false)
    })

    it('rejects name starting with underscore', () => {
      const purl = { namespace: '', name: '_private' }
      expect(npmValidate(purl, { throws: false })).toBe(false)
    })

    // No leading/trailing-space cases here: whitespace is itself an injection
    // char, so the injection validator fires first and the trim-check
    // `return false` branch is unreachable through these validate() entry
    // points. The edge-cases suite covers the trim path with pre-normalized
    // input.

    it('rejects namespace without @ prefix', () => {
      const purl = { namespace: 'no-at', name: 'test' }
      expect(npmValidate(purl, { throws: false })).toBe(false)
    })

    it('rejects namespace injection in namespace field', () => {
      const purl = { namespace: `@scope${INJ}`, name: 'test' }
      expect(npmValidate(purl, { throws: false })).toBe(false)
    })

    it('rejects node_modules as name', () => {
      const purl = { namespace: '', name: 'node_modules' }
      expect(npmValidate(purl, { throws: false })).toBe(false)
    })

    it('rejects favicon.ico as name', () => {
      const purl = { namespace: '', name: 'favicon.ico' }
      expect(npmValidate(purl, { throws: false })).toBe(false)
    })

    it('rejects name longer than 214 characters', () => {
      const purl = { namespace: '', name: 'a'.repeat(215) }
      expect(npmValidate(purl, { throws: false })).toBe(false)
    })

    it('rejects uppercase in modern name', () => {
      const purl = { namespace: '', name: 'MyPackage' }
      expect(npmValidate(purl, { throws: false })).toBe(false)
    })

    it('rejects special characters in modern name', () => {
      const purl = { namespace: '', name: 'my~package' }
      expect(npmValidate(purl, { throws: false })).toBe(false)
    })

    it('rejects core module name', () => {
      // 'worker_threads' is a Node.js builtin that is NOT in the legacy names set,
      // so it passes the legacy check and reaches the isNpmBuiltinName check.
      const purl = { namespace: '', name: 'worker_threads' }
      expect(npmValidate(purl, { throws: false })).toBe(false)
    })

    it('rejects non-URL-friendly name', () => {
      const purl = { namespace: '', name: 'パッケージ' }
      expect(npmValidate(purl, { throws: false })).toBe(false)
    })

    it('rejects non-URL-friendly namespace', () => {
      const purl = { namespace: '@パッケージ', name: 'test' }
      expect(npmValidate(purl, { throws: false })).toBe(false)
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
      expect(validate(purl, { throws: false })).toBe(false)
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
      expect(validate(purl, { throws: false })).toBe(false)
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
      expect(validate(purl, { throws: false })).toBe(false)
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
      expect(validate(purl, { throws: false })).toBe(false)
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
      expect(validate(purl, { throws: false })).toBe(false)
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
      expect(validate(purl, { throws: false })).toBe(false)
    })

    it('rejects injection in name for fallback type (no throw)', () => {
      const validate = getValidator('alpm')
      const purl = {
        type: 'alpm',
        namespace: 'archlinux',
        name: `pacman${INJ}`,
      }
      expect(validate(purl, { throws: false })).toBe(false)
    })

    it('rejects injection in namespace for deb type (no throw)', () => {
      const validate = getValidator('deb')
      const purl = {
        type: 'deb',
        namespace: `debian${INJ}`,
        name: 'curl',
      }
      expect(validate(purl, { throws: false })).toBe(false)
    })

    it('rejects injection in name for deb type (no throw)', () => {
      const validate = getValidator('deb')
      const purl = {
        type: 'deb',
        namespace: 'debian',
        name: `curl${INJ}`,
      }
      expect(validate(purl, { throws: false })).toBe(false)
    })

    it('accepts clean name/namespace for fallback type', () => {
      const validate = getValidator('alpm')
      const purl = {
        type: 'alpm',
        namespace: 'archlinux',
        name: 'pacman',
      }
      expect(validate(purl, { throws: false })).toBe(true)
    })

    it('accepts name without namespace for fallback type', () => {
      const validate = getValidator('rpm')
      const purl = {
        type: 'rpm',
        name: 'curl',
      }
      expect(validate(purl, { throws: false })).toBe(true)
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
      expect(validate(purl, { throws: false })).toBe(false)
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
      expect(validate(purl, { throws: false })).toBe(false)
    })

    it('rejects injection in vscode-extension name (no throw)', () => {
      const validate = getValidator('vscode-extension')
      const purl = {
        type: 'vscode-extension',
        namespace: 'publisher',
        name: `ext${INJ}`,
        version: '1.0.0',
      }
      expect(validate(purl, { throws: false })).toBe(false)
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
        expect(validate(purl, { throws: false })).toBe(false)
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
      expect(validate(purl, { throws: false })).toBe(false)
    })

    it('swift rejects missing version (no throw)', () => {
      const validate = getValidator('swift')
      const purl = {
        type: 'swift',
        namespace: 'github.com/apple',
        name: 'swift-nio',
      }
      expect(validate(purl, { throws: false })).toBe(false)
    })

    it('cran rejects missing version (no throw)', () => {
      const validate = getValidator('cran')
      const purl = { type: 'cran', name: 'ggplot2' }
      expect(validate(purl, { throws: false })).toBe(false)
    })

    it('maven rejects missing namespace (no throw)', () => {
      const validate = getValidator('maven')
      const purl = { type: 'maven', name: 'artifact' }
      expect(validate(purl, { throws: false })).toBe(false)
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
      expect(() => validate(purl, { throws: true })).toThrow()
    })

    it('throws on injection in name for fallback type', () => {
      const validate = getValidator('alpm')
      const purl = {
        type: 'alpm',
        namespace: 'archlinux',
        name: `pacman${INJ}`,
      }
      expect(() => validate(purl, { throws: true })).toThrow()
    })
  })

  // ────────────────────────────────────────────────────
  // npm throw paths for previously uncovered lines
  // ────────────────────────────────────────────────────

  describe('npm-specific throw paths (throws=true)', () => {
    const npmValidate = getValidator('npm')

    it('throws on non-URL-friendly name', () => {
      const purl = { namespace: '', name: 'パッケージ' }
      expect(() => npmValidate(purl, { throws: true })).toThrow(/URL-friendly/)
    })

    it('throws on non-URL-friendly namespace', () => {
      const purl = { namespace: '@パッケージ', name: 'test' }
      expect(() => npmValidate(purl, { throws: true })).toThrow(/URL-friendly/)
    })

    it('throws on uppercase in modern name', () => {
      const purl = { namespace: '', name: 'MyPackage' }
      expect(() => npmValidate(purl, { throws: true })).toThrow(/capital/)
    })
  })
})
