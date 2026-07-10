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
 * @file String round-trip tests for PackageURL. Tests toString serialization
 *   (encoding rules), fromString parsing (decoding, qualifiers, namespaces),
 *   parseString version-separator edge cases, and flyweight cache eviction.
 */
import { describe, expect, it } from 'vitest'

import { PackageURL } from '../src/package-url.mjs'
import { createTestPurl } from './utils/test-helpers.mjs'

describe('PackageURL', () => {
  describe('toString()', () => {
    it.each(['ty#pe', 'ty@pe', 'ty/pe', '1type'])(
      'type %s is validated and rejected',
      type => {
        // Tests type validation rules (no special chars, can't start with number)
        expect(
          () =>
            new PackageURL(
              type,
              undefined,
              'name',
              undefined,
              undefined,
              undefined,
            ),
        ).toThrow(/must match \[A-Za-z0-9\.\\-\]|cannot start with a number/)
      },
    )

    it.each([
      ['#', '%23', 'fragment delimiter'],
      ['@', '%40', 'version separator'],
    ] as const)(
      'should encode special character %s as %s (%s)',
      (char, encoded, _description) => {
        const purl = createTestPurl('type', `na${char}me`, {
          namespace: `name${char}space`,
          qualifiers: { foo: `bar${char}baz` },
          subpath: `sub${char}path`,
          version: `ver${char}sion`,
        })

        const str = purl.toString()
        // Verify all occurrences are encoded
        expect(str).toContain(`name${encoded}space`)
        expect(str).toContain(`na${encoded}me`)
        expect(str).toContain(`ver${encoded}sion`)
        expect(str).toContain(`bar${encoded}baz`)
        expect(str).toContain(`sub${encoded}path`)
      },
    )

    it('path components encode /', () => {
      /* only namespace is allowed to have multiple segments separated by `/`` */
      const purl = createTestPurl('type', 'na/me', {
        namespace: 'namespace1/namespace2',
      })
      expect(purl.toString()).toBe('pkg:type/namespace1/namespace2/na%2Fme')
    })

    it.each([
      [':', 'colon'],
      ['~', 'tilde'],
    ] as const)(
      'leaves %s (%s) literal in every component (purl spec: never percent-encoded)',
      (char, _description) => {
        const purl = createTestPurl('type', `na${char}me`, {
          namespace: `name${char}space`,
          qualifiers: { foo: `bar${char}baz` },
          subpath: `sub${char}path`,
          version: `ver${char}sion`,
        })

        const str = purl.toString()
        expect(str).toContain(`name${char}space`)
        expect(str).toContain(`na${char}me`)
        expect(str).toContain(`ver${char}sion`)
        expect(str).toContain(`bar${char}baz`)
        expect(str).toContain(`sub${char}path`)
      },
    )

    it('keeps colon literal but / and @ encoded in a URL qualifier value', () => {
      // The canonical purl form for a repository_url: colon stays literal, the
      // slashes encode to %2F. This is the shape every conformant impl emits.
      const purl = createTestPurl('generic', 'name', {
        qualifiers: { repository_url: 'https://example.com/repo' },
      })
      expect(purl.toString()).toBe(
        'pkg:generic/name?repository_url=https:%2F%2Fexample.com%2Frepo',
      )
    })
  })

  describe('fromString()', () => {
    it('with qualifiers.checksums', () => {
      const purlString =
        'pkg:npm/packageurl-js@0.0.7?checksums=sha512:b9c27369720d948829a98118e9a35fd09d9018711e30dc2df5f8ae85bb19b2ade4679351c4d96768451ee9e841e5f5a36114a9ef98f4fe5256a5f4ca981736a0'
      const purl = PackageURL.fromString(purlString)

      expect(purl.type).toBe('npm')
      expect(purl.namespace).toBe(undefined)
      expect(purl.name).toBe('packageurl-js')
      expect(purl.version).toBe('0.0.7')
      expect(purl.qualifiers).toStrictEqual({
        __proto__: null,
        checksums:
          'sha512:b9c27369720d948829a98118e9a35fd09d9018711e30dc2df5f8ae85bb19b2ade4679351c4d96768451ee9e841e5f5a36114a9ef98f4fe5256a5f4ca981736a0',
      })
    })

    it('with qualifiers.vcs_url', () => {
      const purlString =
        'pkg:npm/packageurl-js@0.0.7?vcs_url=git%2Bhttps%3A%2F%2Fgithub.com%2Fpackage-url%2Fpackageurl-js.git'
      const purl = PackageURL.fromString(purlString)

      expect(purl.type).toBe('npm')
      expect(purl.namespace).toBe(undefined)
      expect(purl.name).toBe('packageurl-js')
      expect(purl.version).toBe('0.0.7')
      expect(purl.qualifiers).toStrictEqual({
        __proto__: null,
        vcs_url: 'git+https://github.com/package-url/packageurl-js.git',
      })
    })

    it('npm PURL with namespace starting with @', () => {
      const purlString = 'pkg:npm/@aws-crypto/crc32@3.0.0'
      const purl = PackageURL.fromString(purlString)

      expect(purl.type).toBe('npm')
      expect(purl.namespace).toBe('@aws-crypto')
      expect(purl.name).toBe('crc32')
      expect(purl.version).toBe('3.0.0')
    })

    it('namespace with multiple segments', () => {
      const purl = PackageURL.fromString(
        'pkg:type/namespace1/namespace2/na%2Fme',
      )
      expect(purl.type).toBe('type')
      expect(purl.namespace).toBe('namespace1/namespace2')
      expect(purl.name).toBe('na/me')
    })

    it('encoded #', () => {
      const purl = PackageURL.fromString(
        'pkg:type/name%23space/na%23me@ver%23sion?foo=bar%23baz#sub%23path',
      )
      expect(purl.type).toBe('type')
      expect(purl.namespace).toBe('name#space')
      expect(purl.name).toBe('na#me')
      expect(purl.version).toBe('ver#sion')
      expect(purl.qualifiers).toStrictEqual({
        __proto__: null,
        foo: 'bar#baz',
      })
      expect(purl.subpath).toBe('sub#path')
    })

    it('encoded @', () => {
      const purl = PackageURL.fromString(
        'pkg:type/name%40space/na%40me@ver%40sion?foo=bar%40baz#sub%40path',
      )
      expect(purl.type).toBe('type')
      expect(purl.namespace).toBe('name@space')
      expect(purl.name).toBe('na@me')
      expect(purl.version).toBe('ver@sion')
      expect(purl.qualifiers).toStrictEqual({
        __proto__: null,
        foo: 'bar@baz',
      })
      expect(purl.subpath).toBe('sub@path')
    })

    it('should error on decode failures', () => {
      // Tests malformed percent-encoding detection (c8 ignore case in decode.js)
      expect(() => PackageURL.fromString('pkg:type/100%/name')).toThrow(
        /unable to decode "namespace" component/,
      )
      expect(() => PackageURL.fromString('pkg:type/namespace/100%')).toThrow(
        /unable to decode "name" component/,
      )
      expect(() =>
        PackageURL.fromString('pkg:type/namespace/name@100%'),
      ).toThrow(/unable to decode "version" component/)
      expect(() =>
        PackageURL.fromString('pkg:type/namespace/name@1.0?a=100%'),
      ).toThrow(/unable to decode "qualifiers" component/)
      expect(() =>
        PackageURL.fromString('pkg:type/namespace/name@1.0#100%'),
      ).toThrow(/unable to decode "subpath" component/)
    })
  })
})

describe('package-url-parse - "@" before the last "/" is not a version separator', () => {
  it('collapses an npm-type atSignIndex back to -1 when it precedes the pathname last slash', () => {
    // pathname "npm/a@b/c": the npm-only lookup finds '@' at index 5, but the
    // last '/' is at index 7 — the '@' is namespace content ("a@b"), not a
    // version separator, so the whole segment before the final '/' becomes
    // the namespace and no version is extracted.
    const parsed = PackageURL.parseString('pkg:npm/a@b/c')
    expect(parsed[0]).toBe('npm')
    expect(parsed[1]).toBe('a@b')
    expect(parsed[2]).toBe('c')
    expect(parsed[3]).toBeUndefined()
  })
})

describe('PackageURL.fromString flyweight cache eviction', () => {
  it('handles more unique purl strings than cache max (1024) without error', () => {
    // Generate enough unique purl strings to exceed the flyweight cache limit
    for (let i = 0; i < 1030; i += 1) {
      PackageURL.fromString(`pkg:npm/pkg-${i}@1.0.0`)
    }
    // Verify parsing still works after eviction
    const purl = PackageURL.fromString('pkg:npm/lodash@4.17.21')
    expect(purl.name).toBe('lodash')
    expect(purl.version).toBe('4.17.21')
  })
})
