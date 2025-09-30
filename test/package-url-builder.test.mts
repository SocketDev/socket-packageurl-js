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
 * @fileoverview Unit tests for PackageURLBuilder class.
 */
import { describe, expect, it } from 'vitest'

import { PackageURL, PackageURLBuilder } from '../dist/package-url.js'

describe('PackageURLBuilder', () => {
  describe('basic construction', () => {
    it('should build a simple PackageURL', () => {
      const purl = PackageURLBuilder.create().type('npm').name('lodash').build()

      // Cannot use instanceof due to ESM/CJS interop: test imports ESM wrapper,
      // but PackageURLBuilder uses CommonJS require(), creating different class references.
      // Verify constructor name instead.
      expect(purl.constructor.name).toBe('PackageURL')
      expect(purl.type).toBe('npm')
      expect(purl.name).toBe('lodash')
      expect(purl.namespace).toBeUndefined()
      expect(purl.version).toBeUndefined()
      expect(purl.qualifiers).toBeUndefined()
      expect(purl.subpath).toBeUndefined()
    })

    it('should build a complete PackageURL with all fields', () => {
      const purl = PackageURLBuilder.create()
        .type('npm')
        .namespace('@types')
        .name('node')
        .version('16.11.7')
        .qualifiers({ arch: 'x64', os: 'linux' })
        .subpath('lib/fs.d.ts')
        .build()

      expect(purl.type).toBe('npm')
      expect(purl.namespace).toBe('@types')
      expect(purl.name).toBe('node')
      expect(purl.version).toBe('16.11.7')
      expect(purl.qualifiers).toEqual({ arch: 'x64', os: 'linux' })
      expect(purl.subpath).toBe('lib/fs.d.ts')
    })

    it('should support method chaining', () => {
      const builder = PackageURLBuilder.create()

      const result = builder.type('npm').name('lodash')

      expect(result).toBe(builder)
    })
  })

  describe('qualifier management', () => {
    it('should add individual qualifiers', () => {
      const purl = PackageURLBuilder.create()
        .type('npm')
        .name('lodash')
        .qualifier('arch', 'x64')
        .qualifier('os', 'linux')
        .build()

      expect(purl.qualifiers).toEqual({ arch: 'x64', os: 'linux' })
    })

    it('should set all qualifiers at once', () => {
      const purl = PackageURLBuilder.create()
        .type('npm')
        .name('lodash')
        .qualifiers({ arch: 'x64', os: 'linux', env: 'production' })
        .build()

      expect(purl.qualifiers).toEqual({
        arch: 'x64',
        os: 'linux',
        env: 'production',
      })
    })

    it('should overwrite qualifiers when set multiple times', () => {
      const purl = PackageURLBuilder.create()
        .type('npm')
        .name('lodash')
        .qualifier('arch', 'x64')
        .qualifier('arch', 'arm64')
        .build()

      expect(purl.qualifiers).toEqual({ arch: 'arm64' })
    })

    it('should merge individual qualifiers with bulk qualifiers', () => {
      const purl = PackageURLBuilder.create()
        .type('npm')
        .name('lodash')
        .qualifier('arch', 'x64')
        .qualifiers({ os: 'linux', env: 'production' })
        .qualifier('extra', 'value')
        .build()

      expect(purl.qualifiers).toEqual({
        os: 'linux',
        env: 'production',
        extra: 'value',
      })
    })
  })

  describe('static factory methods', () => {
    it('should create with create()', () => {
      const builder = PackageURLBuilder.create()
      expect(builder).toBeInstanceOf(PackageURLBuilder)
    })

    it('should create npm builder', () => {
      const purl = PackageURLBuilder.npm().name('lodash').build()

      expect(purl.type).toBe('npm')
      expect(purl.name).toBe('lodash')
    })

    it('should create pypi builder', () => {
      const purl = PackageURLBuilder.pypi().name('requests').build()

      expect(purl.type).toBe('pypi')
      expect(purl.name).toBe('requests')
    })

    it('should create maven builder', () => {
      const purl = PackageURLBuilder.maven()
        .namespace('org.apache.commons')
        .name('commons-lang3')
        .build()

      expect(purl.type).toBe('maven')
      expect(purl.namespace).toBe('org.apache.commons')
      expect(purl.name).toBe('commons-lang3')
    })

    it('should create gem builder', () => {
      const purl = PackageURLBuilder.gem().name('rails').build()

      expect(purl.type).toBe('gem')
      expect(purl.name).toBe('rails')
    })

    it('should create golang builder', () => {
      const purl = PackageURLBuilder.golang()
        .namespace('github.com/gin-gonic')
        .name('gin')
        .build()

      expect(purl.type).toBe('golang')
      expect(purl.namespace).toBe('github.com/gin-gonic')
      expect(purl.name).toBe('gin')
    })

    it('should create cargo builder', () => {
      const purl = PackageURLBuilder.cargo().name('serde').build()

      expect(purl.type).toBe('cargo')
      expect(purl.name).toBe('serde')
    })

    it('should create nuget builder', () => {
      const purl = PackageURLBuilder.nuget().name('Newtonsoft.Json').build()

      expect(purl.type).toBe('nuget')
      expect(purl.name).toBe('Newtonsoft.Json')
    })

    it('should create composer builder', () => {
      const purl = PackageURLBuilder.composer()
        .namespace('symfony')
        .name('console')
        .build()

      expect(purl.type).toBe('composer')
      expect(purl.namespace).toBe('symfony')
      expect(purl.name).toBe('console')
    })
  })

  describe('from existing PackageURL', () => {
    it('should create builder from existing PackageURL', () => {
      const originalPurl = new PackageURL(
        'npm',
        '@types',
        'node',
        '16.11.7',
        { arch: 'x64' },
        'lib/fs.d.ts',
      )

      const newPurl = PackageURLBuilder.from(originalPurl)
        .version('18.0.0')
        .qualifier('os', 'linux')
        .build()

      expect(newPurl.type).toBe('npm')
      expect(newPurl.namespace).toBe('@types')
      expect(newPurl.name).toBe('node')
      expect(newPurl.version).toBe('18.0.0')
      expect(newPurl.qualifiers).toEqual({ arch: 'x64', os: 'linux' })
      expect(newPurl.subpath).toBe('lib/fs.d.ts')
    })

    it('should handle PackageURL with no qualifiers', () => {
      const originalPurl = new PackageURL(
        'npm',
        undefined,
        'lodash',
        '4.17.21',
        undefined,
        undefined,
      )

      const newPurl = PackageURLBuilder.from(originalPurl)
        .qualifier('extra', 'value')
        .build()

      expect(newPurl.type).toBe('npm')
      expect(newPurl.name).toBe('lodash')
      expect(newPurl.version).toBe('4.17.21')
      expect(newPurl.qualifiers).toEqual({ extra: 'value' })
    })

    it('should not mutate original PackageURL qualifiers', () => {
      const originalPurl = new PackageURL(
        'npm',
        undefined,
        'lodash',
        '4.17.21',
        { arch: 'x64' },
        undefined,
      )

      PackageURLBuilder.from(originalPurl).qualifier('os', 'linux').build()

      expect(originalPurl.qualifiers).toEqual({ arch: 'x64' })
    })
  })

  describe('validation through build', () => {
    it('should validate through PackageURL constructor', () => {
      expect(() => {
        PackageURLBuilder.create().type('').name('lodash').build()
      }).toThrow()
    })

    it('should validate name is required', () => {
      expect(() => {
        PackageURLBuilder.create().type('npm').build()
      }).toThrow()
    })
  })
})
