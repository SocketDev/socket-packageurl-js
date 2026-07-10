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
 * @file Continued URL conversion tests: toDownloadUrl, getAllUrls,
 *   support checks, and ReDoS guard.
 */
import { describe, expect, it } from 'vitest'

import { PackageURL } from '../src/package-url.mjs'
import { UrlConverter } from '../src/url-converter.mjs'

describe('UrlConverter (continued)', () => {
  describe('toDownloadUrl', () => {
    it.each([
      [
        'npm',
        undefined,
        'lodash',
        '4.17.21',
        'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz',
        'tarball',
      ],
      [
        'npm',
        '@types',
        'node',
        '16.11.7',
        'https://registry.npmjs.org/@types/node/-/node-16.11.7.tgz',
        'tarball',
      ],
      [
        'pypi',
        undefined,
        'requests',
        '2.28.1',
        'https://pypi.org/simple/requests/',
        'wheel',
      ],
      [
        'maven',
        'org.apache.commons',
        'commons-lang3',
        '3.12.0',
        'https://repo1.maven.org/maven2/org/apache/commons/commons-lang3/3.12.0/commons-lang3-3.12.0.jar',
        'jar',
      ],
      [
        'gem',
        undefined,
        'rails',
        '7.0.0',
        'https://rubygems.org/downloads/rails-7.0.0.gem',
        'gem',
      ],
      [
        'cargo',
        undefined,
        'serde',
        '1.0.144',
        'https://crates.io/api/v1/crates/serde/1.0.144/download',
        'tarball',
      ],
      [
        'nuget',
        undefined,
        'Newtonsoft.Json',
        '13.0.1',
        'https://nuget.org/packages/Newtonsoft.Json/13.0.1/download',
        'zip',
      ],
      [
        'composer',
        'symfony',
        'console',
        '6.1.0',
        'https://repo.packagist.org/p2/symfony/console.json',
        'other',
      ],
      [
        'hex',
        undefined,
        'phoenix',
        '1.6.0',
        'https://repo.hex.pm/tarballs/phoenix-1.6.0.tar',
        'tarball',
      ],
      [
        'pub',
        undefined,
        'flutter',
        '3.0.0',
        'https://pub.dev/packages/flutter/versions/3.0.0.tar.gz',
        'tarball',
      ],
      [
        'conda',
        undefined,
        'numpy',
        '1.24.0',
        'https://anaconda.org/conda-forge/numpy/1.24.0/download',
        'tarball',
      ],
      [
        'golang',
        'github.com/gin-gonic',
        'gin',
        'v1.8.1',
        'https://proxy.golang.org/github.com/gin-gonic/gin/@v/v1.8.1.zip',
        'zip',
      ],
      // golang preserves case (no normalizer), so an uppercase module path
      // survives to the download URL, where the Go proxy `!`-escape re-encodes
      // it (`DataDog` -> `!data!dog`).
      // inclusive-language: external-api -- `DataDog` is a real GitHub org.
      [
        'golang',
        'github.com/DataDog',
        'datadog-go',
        'v4.8.3+incompatible',
        'https://proxy.golang.org/github.com/!data!dog/datadog-go/@v/v4.8.3+incompatible.zip',
        'zip',
      ],
      // Versions keep their case too, so uppercase in a version is `!`-escaped
      // the same way (e.g. `RC1` -> `!r!c1`).
      [
        'golang',
        'github.com/example',
        'mod',
        'v1.0.0-RC1',
        'https://proxy.golang.org/github.com/example/mod/@v/v1.0.0-!r!c1.zip',
        'zip',
      ],
    ])(
      'should convert %s packages to download URLs',
      (type, namespace, name, version, expectedUrl, expectedType) => {
        const purl = new PackageURL(
          type,
          namespace,
          name,
          version,
          undefined,
          undefined,
        )
        const result = UrlConverter.toDownloadUrl(purl)

        expect(result).toEqual({
          url: expectedUrl,
          type: expectedType,
        })
      },
    )

    it.each([
      ['composer', undefined, 'console', '6.1.0', 'packages without namespace'],
      ['golang', undefined, 'gin', 'v1.8.1', 'packages without namespace'],
      ['npm', undefined, 'lodash', undefined, 'packages without version'],
    ])(
      'should return undefined for %s %s',
      (type, namespace, name, version, _description) => {
        const purl = new PackageURL(
          type,
          namespace,
          name,
          version,
          undefined,
          undefined,
        )
        const result = UrlConverter.toDownloadUrl(purl)

        expect(result).toBeUndefined()
      },
    )

    it('should return undefined for maven packages with empty namespace (defensive)', () => {
      // Create a mock purl object with empty namespace to test defensive undefined check
      const mockPurl = {
        type: 'maven',
        namespace: '',
        name: 'test',
        version: '1.0',
      }
      const result = UrlConverter.toDownloadUrl(
        mockPurl as unknown as PackageURL,
      )

      expect(result).toBeUndefined()
    })

    it('should return undefined for unsupported package types', () => {
      const purl = new PackageURL(
        'unknown',
        undefined,
        'package',
        '1.0.0',
        undefined,
        undefined,
      )
      const result = UrlConverter.toDownloadUrl(purl)

      expect(result).toBeUndefined()
    })
  })

  describe('getAllUrls', () => {
    it('should return both repository and download URLs when available', () => {
      const purl = new PackageURL(
        'npm',
        undefined,
        'lodash',
        '4.17.21',
        undefined,
        undefined,
      )
      const result = UrlConverter.getAllUrls(purl)

      expect(result).toEqual({
        repository: {
          url: 'https://www.npmjs.com/package/lodash/v/4.17.21',
          type: 'web',
        },
        download: {
          url: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz',
          type: 'tarball',
        },
      })
    })

    it('should return undefined for unavailable URLs', () => {
      const purl = new PackageURL(
        'unknown',
        undefined,
        'package',
        '1.0.0',
        undefined,
        undefined,
      )
      const result = UrlConverter.getAllUrls(purl)

      expect(result).toEqual({
        repository: undefined,
        download: undefined,
      })
    })
  })

  describe('support checks', () => {
    it('should correctly identify types supporting repository URLs', () => {
      expect(UrlConverter.supportsRepositoryUrl('npm')).toBe(true)
      expect(UrlConverter.supportsRepositoryUrl('pypi')).toBe(true)
      expect(UrlConverter.supportsRepositoryUrl('maven')).toBe(true)
      expect(UrlConverter.supportsRepositoryUrl('unknown')).toBe(false)
    })

    it('should correctly identify types supporting download URLs', () => {
      expect(UrlConverter.supportsDownloadUrl('npm')).toBe(true)
      expect(UrlConverter.supportsDownloadUrl('pypi')).toBe(true)
      expect(UrlConverter.supportsDownloadUrl('maven')).toBe(true)
      expect(UrlConverter.supportsDownloadUrl('unknown')).toBe(false)
    })
  })

  describe('ReDoS guard', () => {
    it('does not hang on a pathologically long near-match filename', () => {
      // The PyPI/Gem distribution-filename regexes share DIST_VERSION, whose
      // nested quantifiers backtrack super-linearly. distributionFilename caps
      // the filename length so fromUrl returns fast instead of stalling the
      // event loop. Pre-fix, this input burned seconds; capped, it is instant.
      const evil = `pkg-1${'.1'.repeat(20_000)}.whlX`
      const start = Date.now()
      const result = UrlConverter.fromUrl(evil)
      const elapsedMs = Date.now() - start
      expect(result).toBeUndefined()
      expect(elapsedMs).toBeLessThan(250)
    })
  })
})
