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
 * @file Continued type-specific PackageURL tests: generic, socket, unknown,
 *   oci, pypi normalization, luarocks, and vscode-extension validate/normalize.
 */
import { describe, expect, it } from 'vitest'

import { PackageURL } from '../src/package-url.mjs'

describe('PackageURL type-specific tests (continued)', () => {
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

  describe('oci', () => {
    it('should lowercase version per spec', () => {
      const purl = PackageURL.fromString(
        'pkg:oci/myimage@SHA256:ABCDEF1234567890',
      )
      expect(purl.name).toBe('myimage')
      expect(purl.version).toBe('sha256:abcdef1234567890')
    })
  })

  describe('pypi normalization', () => {
    it('should lowercase name + dash-normalize, preserve version', () => {
      // PEP 503 normalizes the NAME (lowercase + `_`/`.`→`-`). The version is an
      // opaque locator with no purl-spec normalization rule, so it is preserved
      // (PEP 440 case-folding is a comparison-layer concern, not canonical form).
      const purl = PackageURL.fromString('pkg:pypi/Django_Thing@3.0.0RC1')
      expect(purl.name).toBe('django-thing')
      expect(purl.version).toBe('3.0.0RC1')
    })
  })

  describe('luarocks', () => {
    it('should lowercase namespace + name, preserve version', () => {
      // Author + rock name are case-insensitive (client lowercases both); the
      // version is case-sensitive (scm-1 ≠ SCM-1) and is preserved.
      const purl = PackageURL.fromString(
        'pkg:luarocks/Hisham/LuaFileSystem@SCM-1',
      )
      expect(purl.namespace).toBe('hisham')
      expect(purl.name).toBe('luafilesystem')
      expect(purl.version).toBe('SCM-1')
      expect(purl.toString()).toBe('pkg:luarocks/hisham/luafilesystem@SCM-1')
    })
  })
})
