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
 * @fileoverview Unit tests for URL conversion functionality.
 */
import { describe, expect, it } from 'vitest'

import { PackageURL } from '../dist/package-url.js'
import { UrlConverter } from '../dist/url-converter.js'

describe('UrlConverter', () => {
  describe('toRepositoryUrl', () => {
    it.each([
      [
        'npm',
        undefined,
        'lodash',
        '4.17.21',
        'https://npmjs.com/package/lodash',
        'web',
      ],
      [
        'npm',
        '@types',
        'node',
        '16.11.7',
        'https://npmjs.com/package/@types/node',
        'web',
      ],
      [
        'pypi',
        undefined,
        'requests',
        '2.28.1',
        'https://pypi.org/project/requests/',
        'web',
      ],
      [
        'maven',
        'org.apache.commons',
        'commons-lang3',
        '3.12.0',
        'https://repo1.maven.org/maven2/org/apache/commons/commons-lang3/',
        'web',
      ],
      [
        'gem',
        undefined,
        'rails',
        '7.0.0',
        'https://rubygems.org/gems/rails',
        'web',
      ],
      [
        'golang',
        'github.com/gin-gonic',
        'gin',
        'v1.8.1',
        'https://github.com/gin-gonic/gin',
        'git',
      ],
      [
        'cargo',
        undefined,
        'serde',
        '1.0.144',
        'https://crates.io/crates/serde',
        'web',
      ],
      [
        'nuget',
        undefined,
        'Newtonsoft.Json',
        '13.0.1',
        'https://nuget.org/packages/Newtonsoft.Json/',
        'web',
      ],
      [
        'composer',
        'symfony',
        'console',
        '6.1.0',
        'https://packagist.org/packages/symfony/console',
        'web',
      ],
      [
        'github',
        'octocat',
        'hello-world',
        undefined,
        'https://github.com/octocat/hello-world',
        'git',
      ],
      [
        'gitlab',
        'group',
        'project',
        undefined,
        'https://gitlab.com/group/project',
        'git',
      ],
      [
        'bitbucket',
        'user',
        'repo',
        undefined,
        'https://bitbucket.org/user/repo',
        'git',
      ],
      [
        'hex',
        undefined,
        'phoenix',
        '1.6.0',
        'https://hex.pm/packages/phoenix',
        'web',
      ],
      [
        'pub',
        undefined,
        'flutter',
        '3.0.0',
        'https://pub.dev/packages/flutter',
        'web',
      ],
      [
        'luarocks',
        'user',
        'rock',
        '1.0.0',
        'https://luarocks.org/modules/user/rock',
        'web',
      ],
      [
        'luarocks',
        undefined,
        'rock',
        '1.0.0',
        'https://luarocks.org/modules/rock',
        'web',
      ],
      [
        'composer',
        undefined,
        'package',
        '1.0.0',
        'https://packagist.org/packages/package',
        'web',
      ],
    ])(
      'should convert %s packages to repository URLs',
      (type, namespace, name, version, expectedUrl, expectedType) => {
        const purl = new PackageURL(
          type,
          namespace,
          name,
          version,
          undefined,
          undefined,
        )
        const result = UrlConverter.toRepositoryUrl(purl)

        expect(result).toEqual({
          url: expectedUrl,
          type: expectedType,
        })
      },
    )

    it.each([
      ['golang', undefined, 'gin', 'v1.8.1', 'packages without namespace'],
      ['github', undefined, 'repo', undefined, 'packages without namespace'],
      ['gitlab', undefined, 'project', undefined, 'packages without namespace'],
      ['bitbucket', undefined, 'repo', undefined, 'packages without namespace'],
    ])(
      'should return null for %s %s',
      (type, namespace, name, version, _description) => {
        const purl = new PackageURL(
          type,
          namespace,
          name,
          version,
          undefined,
          undefined,
        )
        const result = UrlConverter.toRepositoryUrl(purl)

        expect(result).toBeNull()
      },
    )

    it('should return null for maven packages with empty namespace (defensive)', () => {
      // Create a mock purl object with empty namespace to test defensive null check
      const mockPurl = {
        type: 'maven',
        namespace: '',
        name: 'test',
        version: '1.0',
      }
      const result = UrlConverter.toRepositoryUrl(mockPurl as any)

      expect(result).toBeNull()
    })

    it('should return null for unsupported package types', () => {
      const purl = new PackageURL(
        'unknown',
        undefined,
        'package',
        '1.0.0',
        undefined,
        undefined,
      )
      const result = UrlConverter.toRepositoryUrl(purl)

      expect(result).toBeNull()
    })
  })

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
        'golang',
        'github.com/gin-gonic',
        'gin',
        'v1.8.1',
        'https://proxy.golang.org/github.com/gin-gonic/gin/@v/v1.8.1.zip',
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
      'should return null for %s %s',
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

        expect(result).toBeNull()
      },
    )

    it('should return null for maven packages with empty namespace (defensive)', () => {
      // Create a mock purl object with empty namespace to test defensive null check
      const mockPurl = {
        type: 'maven',
        namespace: '',
        name: 'test',
        version: '1.0',
      }
      const result = UrlConverter.toDownloadUrl(mockPurl as any)

      expect(result).toBeNull()
    })

    it('should return null for unsupported package types', () => {
      const purl = new PackageURL(
        'unknown',
        undefined,
        'package',
        '1.0.0',
        undefined,
        undefined,
      )
      const result = UrlConverter.toDownloadUrl(purl)

      expect(result).toBeNull()
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
          url: 'https://npmjs.com/package/lodash',
          type: 'web',
        },
        download: {
          url: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz',
          type: 'tarball',
        },
      })
    })

    it('should return null for unavailable URLs', () => {
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
        repository: null,
        download: null,
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
})
