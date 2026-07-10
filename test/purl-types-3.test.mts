/**
 * @file Type-specific PackageURL tests continued: julia, opam, otp, yocto,
 *   docker, and vscode-extension (basic normalization).
 */
import { describe, expect, it } from 'vitest'

import { PackageURL } from '../src/package-url.mjs'

describe('PackageURL type-specific tests (part 3)', () => {
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

    it('should reject julia packages without the uuid qualifier', () => {
      expect(() => {
        return new PackageURL(
          'julia',
          undefined,
          'DataFrames',
          '1.5.0',
          undefined,
          undefined,
        )
      }).toThrow('julia requires a "uuid" qualifier')
    })

    it('should accept julia packages without namespace', () => {
      const purl = new PackageURL(
        'julia',
        undefined,
        'DataFrames',
        '1.5.0',
        { uuid: 'a93c6f00-e57d-5684-b7b6-d8193f3e46c0' },
        undefined,
      )
      expect(purl.toString()).toBe(
        'pkg:julia/DataFrames@1.5.0?uuid=a93c6f00-e57d-5684-b7b6-d8193f3e46c0',
      )
    })

    it('should preserve case in julia package names', () => {
      // Julia names are case-sensitive (typically CamelCase)
      const purl = new PackageURL(
        'julia',
        undefined,
        'DataFrames',
        '1.5.0',
        { uuid: 'a93c6f00-e57d-5684-b7b6-d8193f3e46c0' },
        undefined,
      )
      expect(purl.name).toBe('DataFrames')
      expect(purl.toString()).toBe(
        'pkg:julia/DataFrames@1.5.0?uuid=a93c6f00-e57d-5684-b7b6-d8193f3e46c0',
      )
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
    it('should accept and lowercase the optional layer namespace', () => {
      // The namespace is the layer name (BBFILE_COLLECTIONS), optional and
      // case-insensitive. Matches the canonical fixture pkg:yocto/core/glibc.
      const purl = new PackageURL(
        'yocto',
        'Core',
        'glibc',
        '2.35',
        undefined,
        undefined,
      )
      expect(purl.namespace).toBe('core')
      expect(purl.toString()).toBe('pkg:yocto/core/glibc@2.35')
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

    it('should preserve yocto recipe name case', () => {
      // The name (recipe PN/BPN) is case-sensitive — BitBake derives it verbatim
      // from the .bb filename. Lowercase is a convention, not enforced.
      const purl = new PackageURL(
        'yocto',
        undefined,
        'ZLib',
        '1.2.11',
        undefined,
        undefined,
      )
      expect(purl.name).toBe('ZLib')
      expect(purl.toString()).toBe('pkg:yocto/ZLib@1.2.11')
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

    it('should lowercase the user/org namespace', () => {
      // The namespace is a user/org path-component (lowercase-only by Docker's
      // reference grammar). A registry host belongs in repository_url, never the
      // namespace, so folding the namespace is never lossy.
      const purl = new PackageURL(
        'docker',
        'CustomerOrg',
        'myapp',
        'v1.0',
        undefined,
        undefined,
      )
      expect(purl.namespace).toBe('customerorg')
      expect(purl.toString()).toBe('pkg:docker/customerorg/myapp@v1.0')
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
})
