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
 * @file Unit tests for UrlConverter.fromUrl — per-registry URL-to-purl parsing
 *   edge cases and unrecognized-path handling.
 */
import { describe, expect, it } from 'vitest'

// Importing PackageURL also registers the class with UrlConverter (module-load
// side effect) — without it every fromUrl call returns undefined.
import { PackageURL } from '../src/package-url.mjs'
import { UrlConverter } from '../src/url-converter.mjs'

describe('url-converter.mts — fromCpanUrl release segment with no dash', () => {
  it('returns a version-less cpan purl when the dist segment contains no dash', () => {
    const result = UrlConverter.fromUrl(
      'https://metacpan.org/release/ETHER/DBI',
    )
    expect(result).toBeInstanceOf(PackageURL)
    expect(result!.type).toBe('cpan')
    expect(result!.namespace).toBe('ETHER')
    expect(result!.name).toBe('DBI')
    expect(result!.version).toBeUndefined()
  })
})

describe('url-converter.mts — fromHackageUrl name with a hyphen not followed by a digit', () => {
  it('keeps the full name intact instead of splitting on a non-version hyphen', () => {
    const result = UrlConverter.fromUrl(
      'https://hackage.haskell.org/package/text-icu',
    )
    expect(result).toBeDefined()
    expect(result!.type).toBe('hackage')
    expect(result!.name).toBe('text-icu')
    expect(result!.version).toBeUndefined()
  })
})

describe('UrlConverter.fromUrl edge cases', () => {
  describe('npm registry — unscoped tarball', () => {
    it('extracts version from tarball URL', () => {
      const purl = UrlConverter.fromUrl(
        'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz',
      )
      expect(purl).toBeDefined()
      expect(purl!.type).toBe('npm')
      expect(purl!.name).toBe('lodash')
      expect(purl!.version).toBe('4.17.21')
    })

    it('returns purl without version for non-tgz tarball path', () => {
      const purl = UrlConverter.fromUrl(
        'https://registry.npmjs.org/lodash/-/lodash-4.17.21.zip',
      )
      expect(purl).toBeDefined()
      expect(purl!.name).toBe('lodash')
      // .zip is not matched by tgz parser, so no version extraction
      expect(purl!.version).toBeUndefined()
    })
  })

  describe('npm registry — unscoped with version segment', () => {
    it('extracts version from path', () => {
      const purl = UrlConverter.fromUrl(
        'https://registry.npmjs.org/lodash/4.17.21',
      )
      expect(purl).toBeDefined()
      expect(purl!.name).toBe('lodash')
      expect(purl!.version).toBe('4.17.21')
    })
  })

  describe('npm website — unscoped package with version', () => {
    it('extracts version from /v/ path', () => {
      const purl = UrlConverter.fromUrl(
        'https://www.npmjs.com/package/express/v/4.18.2',
      )
      expect(purl).toBeDefined()
      expect(purl!.name).toBe('express')
      expect(purl!.version).toBe('4.18.2')
    })
  })

  describe('Docker Hub', () => {
    it('returns undefined for unrecognized Docker path', () => {
      const purl = UrlConverter.fromUrl('https://hub.docker.com/search?q=nginx')
      expect(purl).toBeUndefined()
    })
  })

  describe('MetaCPAN', () => {
    it('parses /release/ URL with author and versioned dist', () => {
      const purl = UrlConverter.fromUrl(
        'https://metacpan.org/release/ETHER/Moose-2.2206',
      )
      expect(purl).toBeDefined()
      expect(purl!.type).toBe('cpan')
      expect(purl!.namespace).toBe('ETHER')
      expect(purl!.name).toBe('Moose')
      expect(purl!.version).toBe('2.2206')
    })

    it('returns undefined for authorless /pod/ and /dist/ URLs', () => {
      // No author id on these pages, so no spec-valid cpan purl (namespace
      // required) can be produced.
      expect(
        UrlConverter.fromUrl('https://metacpan.org/pod/Moose'),
      ).toBeUndefined()
      expect(
        UrlConverter.fromUrl('https://metacpan.org/dist/Moose'),
      ).toBeUndefined()
    })

    it('returns undefined for unrecognized CPAN path', () => {
      const purl = UrlConverter.fromUrl('https://metacpan.org/about')
      expect(purl).toBeUndefined()
    })
  })

  describe('Maven Central', () => {
    it('parses maven2 URL with group/artifact/version', () => {
      const purl = UrlConverter.fromUrl(
        'https://repo1.maven.org/maven2/org/apache/commons/commons-lang3/3.12.0',
      )
      expect(purl).toBeDefined()
      expect(purl!.type).toBe('maven')
      expect(purl!.namespace).toBe('org.apache.commons')
      expect(purl!.name).toBe('commons-lang3')
      expect(purl!.version).toBe('3.12.0')
    })

    it('returns undefined for maven2 URL with too few path segments', () => {
      const purl = UrlConverter.fromUrl('https://repo1.maven.org/maven2/org')
      expect(purl).toBeUndefined()
    })
  })

  describe('RubyGems', () => {
    it('parses gem URL with version', () => {
      const purl = UrlConverter.fromUrl(
        'https://rubygems.org/gems/rails/versions/7.1.0',
      )
      expect(purl).toBeDefined()
      expect(purl!.type).toBe('gem')
      expect(purl!.name).toBe('rails')
      expect(purl!.version).toBe('7.1.0')
    })
  })

  describe('crates.io', () => {
    it('parses /crates/name/version URL', () => {
      const purl = UrlConverter.fromUrl(
        'https://crates.io/crates/serde/1.0.197',
      )
      expect(purl).toBeDefined()
      expect(purl!.type).toBe('cargo')
      expect(purl!.name).toBe('serde')
      expect(purl!.version).toBe('1.0.197')
    })
  })

  describe('NuGet', () => {
    it('parses www.nuget.org /packages/Name/version', () => {
      const purl = UrlConverter.fromUrl(
        'https://www.nuget.org/packages/Newtonsoft.Json/13.0.3',
      )
      expect(purl).toBeDefined()
      expect(purl!.type).toBe('nuget')
      expect(purl!.name).toBe('Newtonsoft.Json')
      expect(purl!.version).toBe('13.0.3')
    })
  })

  describe('PyPI', () => {
    it('parses pypi.org /project/name/version URL', () => {
      const purl = UrlConverter.fromUrl(
        'https://pypi.org/project/requests/2.31.0',
      )
      expect(purl).toBeDefined()
      expect(purl!.type).toBe('pypi')
      expect(purl!.name).toBe('requests')
      expect(purl!.version).toBe('2.31.0')
    })
  })
})

describe('UrlConverter unrecognized paths', () => {
  it('Docker Hub unrecognized path returns undefined', () => {
    // Path is not /_/ or /r/ — hits the return undefined at end of fromDockerUrl
    const result = UrlConverter.fromUrl(
      'https://hub.docker.com/v2/repositories/library/nginx',
    )
    expect(result).toBeUndefined()
  })

  it('MetaCPAN unrecognized path returns undefined', () => {
    // Path first segment is not "pod" or "dist" — hits return undefined at end of fromCpanUrl
    const result = UrlConverter.fromUrl('https://metacpan.org/author/ETHER')
    expect(result).toBeUndefined()
  })
})
