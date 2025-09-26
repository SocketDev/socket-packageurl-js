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

import { PackageURL } from '../src/package-url.js'
import { UrlConverter } from '../src/url-converter.js'

describe('UrlConverter', () => {
  describe('toRepositoryUrl', () => {
    it('should convert npm packages to repository URLs', () => {
      const purl = new PackageURL(
        'npm',
        undefined,
        'lodash',
        '4.17.21',
        undefined,
        undefined,
      )
      const result = UrlConverter.toRepositoryUrl(purl)

      expect(result).toEqual({
        url: 'https://npmjs.com/package/lodash',
        type: 'web',
      })
    })

    it('should convert scoped npm packages to repository URLs', () => {
      const purl = new PackageURL(
        'npm',
        '@types',
        'node',
        '16.11.7',
        undefined,
        undefined,
      )
      const result = UrlConverter.toRepositoryUrl(purl)

      expect(result).toEqual({
        url: 'https://npmjs.com/package/@types/node',
        type: 'web',
      })
    })

    it('should convert pypi packages to repository URLs', () => {
      const purl = new PackageURL(
        'pypi',
        undefined,
        'requests',
        '2.28.1',
        undefined,
        undefined,
      )
      const result = UrlConverter.toRepositoryUrl(purl)

      expect(result).toEqual({
        url: 'https://pypi.org/project/requests/',
        type: 'web',
      })
    })

    it('should convert maven packages to repository URLs', () => {
      const purl = new PackageURL(
        'maven',
        'org.apache.commons',
        'commons-lang3',
        '3.12.0',
        undefined,
        undefined,
      )
      const result = UrlConverter.toRepositoryUrl(purl)

      expect(result).toEqual({
        url: 'https://repo1.maven.org/maven2/org/apache/commons/commons-lang3/',
        type: 'web',
      })
    })

    it('should convert gem packages to repository URLs', () => {
      const purl = new PackageURL(
        'gem',
        undefined,
        'rails',
        '7.0.0',
        undefined,
        undefined,
      )
      const result = UrlConverter.toRepositoryUrl(purl)

      expect(result).toEqual({
        url: 'https://rubygems.org/gems/rails',
        type: 'web',
      })
    })

    it('should convert golang packages to repository URLs', () => {
      const purl = new PackageURL(
        'golang',
        'github.com/gin-gonic',
        'gin',
        'v1.8.1',
        undefined,
        undefined,
      )
      const result = UrlConverter.toRepositoryUrl(purl)

      expect(result).toEqual({
        url: 'https://github.com/gin-gonic/gin',
        type: 'git',
      })
    })

    it('should return null for golang packages without namespace', () => {
      const purl = new PackageURL(
        'golang',
        undefined,
        'gin',
        'v1.8.1',
        undefined,
        undefined,
      )
      const result = UrlConverter.toRepositoryUrl(purl)

      expect(result).toBeNull()
    })

    it('should convert cargo packages to repository URLs', () => {
      const purl = new PackageURL(
        'cargo',
        undefined,
        'serde',
        '1.0.144',
        undefined,
        undefined,
      )
      const result = UrlConverter.toRepositoryUrl(purl)

      expect(result).toEqual({
        url: 'https://crates.io/crates/serde',
        type: 'web',
      })
    })

    it('should convert nuget packages to repository URLs', () => {
      const purl = new PackageURL(
        'nuget',
        undefined,
        'Newtonsoft.Json',
        '13.0.1',
        undefined,
        undefined,
      )
      const result = UrlConverter.toRepositoryUrl(purl)

      expect(result).toEqual({
        url: 'https://nuget.org/packages/Newtonsoft.Json/',
        type: 'web',
      })
    })

    it('should convert composer packages to repository URLs', () => {
      const purl = new PackageURL(
        'composer',
        'symfony',
        'console',
        '6.1.0',
        undefined,
        undefined,
      )
      const result = UrlConverter.toRepositoryUrl(purl)

      expect(result).toEqual({
        url: 'https://packagist.org/packages/symfony/console',
        type: 'web',
      })
    })

    it('should convert github packages to repository URLs', () => {
      const purl = new PackageURL(
        'github',
        'octocat',
        'hello-world',
        undefined,
        undefined,
        undefined,
      )
      const result = UrlConverter.toRepositoryUrl(purl)

      expect(result).toEqual({
        url: 'https://github.com/octocat/hello-world',
        type: 'git',
      })
    })

    it('should convert gitlab packages to repository URLs', () => {
      const purl = new PackageURL(
        'gitlab',
        'group',
        'project',
        undefined,
        undefined,
        undefined,
      )
      const result = UrlConverter.toRepositoryUrl(purl)

      expect(result).toEqual({
        url: 'https://gitlab.com/group/project',
        type: 'git',
      })
    })

    it('should convert bitbucket packages to repository URLs', () => {
      const purl = new PackageURL(
        'bitbucket',
        'user',
        'repo',
        undefined,
        undefined,
        undefined,
      )
      const result = UrlConverter.toRepositoryUrl(purl)

      expect(result).toEqual({
        url: 'https://bitbucket.org/user/repo',
        type: 'git',
      })
    })

    it('should convert hex packages to repository URLs', () => {
      const purl = new PackageURL(
        'hex',
        undefined,
        'phoenix',
        '1.6.0',
        undefined,
        undefined,
      )
      const result = UrlConverter.toRepositoryUrl(purl)

      expect(result).toEqual({
        url: 'https://hex.pm/packages/phoenix',
        type: 'web',
      })
    })

    it('should convert pub packages to repository URLs', () => {
      const purl = new PackageURL(
        'pub',
        undefined,
        'flutter',
        '3.0.0',
        undefined,
        undefined,
      )
      const result = UrlConverter.toRepositoryUrl(purl)

      expect(result).toEqual({
        url: 'https://pub.dev/packages/flutter',
        type: 'web',
      })
    })

    it('should convert luarocks packages to repository URLs', () => {
      const purl = new PackageURL(
        'luarocks',
        'user',
        'rock',
        '1.0.0',
        undefined,
        undefined,
      )
      const result = UrlConverter.toRepositoryUrl(purl)

      expect(result).toEqual({
        url: 'https://luarocks.org/modules/user/rock',
        type: 'web',
      })
    })

    it('should convert luarocks packages without namespace to repository URLs', () => {
      const purl = new PackageURL(
        'luarocks',
        undefined,
        'rock',
        '1.0.0',
        undefined,
        undefined,
      )
      const result = UrlConverter.toRepositoryUrl(purl)

      expect(result).toEqual({
        url: 'https://luarocks.org/modules/rock',
        type: 'web',
      })
    })

    it('should convert composer packages without namespace to repository URLs', () => {
      const purl = new PackageURL(
        'composer',
        undefined,
        'package',
        '1.0.0',
        undefined,
        undefined,
      )
      const result = UrlConverter.toRepositoryUrl(purl)

      expect(result).toEqual({
        url: 'https://packagist.org/packages/package',
        type: 'web',
      })
    })

    it('should return null for github packages without namespace', () => {
      const purl = new PackageURL(
        'github',
        undefined,
        'repo',
        undefined,
        undefined,
        undefined,
      )
      const result = UrlConverter.toRepositoryUrl(purl)

      expect(result).toBeNull()
    })

    it('should return null for gitlab packages without namespace', () => {
      const purl = new PackageURL(
        'gitlab',
        undefined,
        'project',
        undefined,
        undefined,
        undefined,
      )
      const result = UrlConverter.toRepositoryUrl(purl)

      expect(result).toBeNull()
    })

    it('should return null for bitbucket packages without namespace', () => {
      const purl = new PackageURL(
        'bitbucket',
        undefined,
        'repo',
        undefined,
        undefined,
        undefined,
      )
      const result = UrlConverter.toRepositoryUrl(purl)

      expect(result).toBeNull()
    })

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
    it('should convert npm packages to download URLs', () => {
      const purl = new PackageURL(
        'npm',
        undefined,
        'lodash',
        '4.17.21',
        undefined,
        undefined,
      )
      const result = UrlConverter.toDownloadUrl(purl)

      expect(result).toEqual({
        url: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz',
        type: 'tarball',
      })
    })

    it('should convert scoped npm packages to download URLs', () => {
      const purl = new PackageURL(
        'npm',
        '@types',
        'node',
        '16.11.7',
        undefined,
        undefined,
      )
      const result = UrlConverter.toDownloadUrl(purl)

      expect(result).toEqual({
        url: 'https://registry.npmjs.org/@types/node/-/node-16.11.7.tgz',
        type: 'tarball',
      })
    })

    it('should convert pypi packages to download URLs', () => {
      const purl = new PackageURL(
        'pypi',
        undefined,
        'requests',
        '2.28.1',
        undefined,
        undefined,
      )
      const result = UrlConverter.toDownloadUrl(purl)

      expect(result).toEqual({
        url: 'https://pypi.org/simple/requests/',
        type: 'wheel',
      })
    })

    it('should convert maven packages to download URLs', () => {
      const purl = new PackageURL(
        'maven',
        'org.apache.commons',
        'commons-lang3',
        '3.12.0',
        undefined,
        undefined,
      )
      const result = UrlConverter.toDownloadUrl(purl)

      expect(result).toEqual({
        url: 'https://repo1.maven.org/maven2/org/apache/commons/commons-lang3/3.12.0/commons-lang3-3.12.0.jar',
        type: 'jar',
      })
    })

    it('should convert gem packages to download URLs', () => {
      const purl = new PackageURL(
        'gem',
        undefined,
        'rails',
        '7.0.0',
        undefined,
        undefined,
      )
      const result = UrlConverter.toDownloadUrl(purl)

      expect(result).toEqual({
        url: 'https://rubygems.org/downloads/rails-7.0.0.gem',
        type: 'gem',
      })
    })

    it('should convert cargo packages to download URLs', () => {
      const purl = new PackageURL(
        'cargo',
        undefined,
        'serde',
        '1.0.144',
        undefined,
        undefined,
      )
      const result = UrlConverter.toDownloadUrl(purl)

      expect(result).toEqual({
        url: 'https://crates.io/api/v1/crates/serde/1.0.144/download',
        type: 'tarball',
      })
    })

    it('should convert nuget packages to download URLs', () => {
      const purl = new PackageURL(
        'nuget',
        undefined,
        'Newtonsoft.Json',
        '13.0.1',
        undefined,
        undefined,
      )
      const result = UrlConverter.toDownloadUrl(purl)

      expect(result).toEqual({
        url: 'https://nuget.org/packages/Newtonsoft.Json/13.0.1/download',
        type: 'zip',
      })
    })

    it('should convert composer packages to download URLs', () => {
      const purl = new PackageURL(
        'composer',
        'symfony',
        'console',
        '6.1.0',
        undefined,
        undefined,
      )
      const result = UrlConverter.toDownloadUrl(purl)

      expect(result).toEqual({
        url: 'https://repo.packagist.org/p2/symfony/console.json',
        type: 'other',
      })
    })

    it('should return null for composer packages without namespace', () => {
      const purl = new PackageURL(
        'composer',
        undefined,
        'console',
        '6.1.0',
        undefined,
        undefined,
      )
      const result = UrlConverter.toDownloadUrl(purl)

      expect(result).toBeNull()
    })

    it('should convert hex packages to download URLs', () => {
      const purl = new PackageURL(
        'hex',
        undefined,
        'phoenix',
        '1.6.0',
        undefined,
        undefined,
      )
      const result = UrlConverter.toDownloadUrl(purl)

      expect(result).toEqual({
        url: 'https://repo.hex.pm/tarballs/phoenix-1.6.0.tar',
        type: 'tarball',
      })
    })

    it('should convert pub packages to download URLs', () => {
      const purl = new PackageURL(
        'pub',
        undefined,
        'flutter',
        '3.0.0',
        undefined,
        undefined,
      )
      const result = UrlConverter.toDownloadUrl(purl)

      expect(result).toEqual({
        url: 'https://pub.dev/packages/flutter/versions/3.0.0.tar.gz',
        type: 'tarball',
      })
    })

    it('should convert golang packages to download URLs', () => {
      const purl = new PackageURL(
        'golang',
        'github.com/gin-gonic',
        'gin',
        'v1.8.1',
        undefined,
        undefined,
      )
      const result = UrlConverter.toDownloadUrl(purl)

      expect(result).toEqual({
        url: 'https://proxy.golang.org/github.com/gin-gonic/gin/@v/v1.8.1.zip',
        type: 'zip',
      })
    })

    it('should return null for golang packages without namespace', () => {
      const purl = new PackageURL(
        'golang',
        undefined,
        'gin',
        'v1.8.1',
        undefined,
        undefined,
      )
      const result = UrlConverter.toDownloadUrl(purl)

      expect(result).toBeNull()
    })

    it('should return null for packages without version', () => {
      const purl = new PackageURL(
        'npm',
        undefined,
        'lodash',
        undefined,
        undefined,
        undefined,
      )
      const result = UrlConverter.toDownloadUrl(purl)

      expect(result).toBeNull()
    })

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
