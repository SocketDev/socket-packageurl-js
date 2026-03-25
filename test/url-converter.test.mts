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
    it.each([
      [
        'npm',
        undefined,
        'lodash',
        '4.17.21',
        'https://www.npmjs.com/package/lodash/v/4.17.21',
        'web',
      ],
      [
        'npm',
        '@types',
        'node',
        '16.11.7',
        'https://www.npmjs.com/package/@types/node/v/16.11.7',
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
        'https://search.maven.org/artifact/org.apache.commons/commons-lang3/3.12.0/jar',
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
        'https://pkg.go.dev/github.com/gin-gonic/gin@v1.8.1',
        'web',
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
      [
        'bioconductor',
        undefined,
        'GenomicRanges',
        '1.50.0',
        'https://bioconductor.org/packages/GenomicRanges',
        'web',
      ],
      [
        'chrome',
        undefined,
        'cjpalhdlnbpafiamejdnhcphjbkeiagm',
        undefined,
        'https://chromewebstore.google.com/detail/cjpalhdlnbpafiamejdnhcphjbkeiagm',
        'web',
      ],
      [
        'clojars',
        'org.clojure',
        'clojure',
        '1.11.1',
        'https://clojars.org/org.clojure/clojure',
        'web',
      ],
      [
        'cocoapods',
        undefined,
        'AFNetworking',
        '4.0.0',
        'https://cocoapods.org/pods/AFNetworking',
        'web',
      ],
      [
        'conan',
        undefined,
        'zlib',
        '1.2.13',
        'https://conan.io/center/recipes/zlib',
        'web',
      ],
      [
        'conda',
        undefined,
        'numpy',
        '1.24.0',
        'https://anaconda.org/conda-forge/numpy',
        'web',
      ],
      [
        'cpan',
        'MOOSE',
        'Role',
        '2.2203',
        'https://metacpan.org/pod/MOOSE::Role',
        'web',
      ],
      [
        'cpan',
        undefined,
        'DBI',
        '1.643',
        'https://metacpan.org/pod/DBI',
        'web',
      ],
      [
        'deno',
        undefined,
        'oak',
        '12.6.0',
        'https://deno.land/x/oak@12.6.0',
        'web',
      ],
      ['deno', undefined, 'oak', undefined, 'https://deno.land/x/oak', 'web'],
      [
        'docker',
        undefined,
        'nginx',
        'latest',
        'https://hub.docker.com/_/nginx?tab=tags&name=latest',
        'web',
      ],
      [
        'docker',
        'library',
        'nginx',
        undefined,
        'https://hub.docker.com/_/nginx',
        'web',
      ],
      [
        'docker',
        'bitnami',
        'postgresql',
        '15',
        'https://hub.docker.com/r/bitnami/postgresql?tab=tags&name=15',
        'web',
      ],
      [
        'elm',
        'elm',
        'json',
        '1.1.3',
        'https://package.elm-lang.org/packages/elm/json/1.1.3',
        'web',
      ],
      [
        'hackage',
        undefined,
        'aeson',
        '2.1.0.0',
        'https://hackage.haskell.org/package/aeson-2.1.0.0',
        'web',
      ],
      [
        'hackage',
        undefined,
        'aeson',
        undefined,
        'https://hackage.haskell.org/package/aeson',
        'web',
      ],
      [
        'homebrew',
        undefined,
        'wget',
        '1.21.4',
        'https://formulae.brew.sh/formula/wget',
        'web',
      ],
      [
        'huggingface',
        'google',
        'bert-base-uncased',
        undefined,
        'https://huggingface.co/google/bert-base-uncased',
        'web',
      ],
      [
        'huggingface',
        undefined,
        'bert-base-uncased',
        undefined,
        'https://huggingface.co/bert-base-uncased',
        'web',
      ],
      [
        'swift',
        'apple',
        'swift-argument-parser',
        '1.2.0',
        'https://github.com/apple/swift-argument-parser',
        'git',
      ],
      [
        'vscode',
        'ms-python',
        'python',
        '2024.0.1',
        'https://marketplace.visualstudio.com/items?itemName=ms-python.python',
        'web',
      ],
      [
        'vscode',
        undefined,
        'python',
        undefined,
        'https://marketplace.visualstudio.com/items?itemName=python',
        'web',
      ],
      [
        'github',
        'octocat',
        'hello-world',
        'v1.0.0',
        'https://github.com/octocat/hello-world/tree/v1.0.0',
        'git',
      ],
      [
        'bitbucket',
        'user',
        'repo',
        'v1.0.0',
        'https://bitbucket.org/user/repo/src/v1.0.0',
        'git',
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
        const result = UrlConverter.toRepositoryUrl(purl)

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
      const result = UrlConverter.toRepositoryUrl(mockPurl as any)

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
      const result = UrlConverter.toRepositoryUrl(purl)

      expect(result).toBeUndefined()
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
      const result = UrlConverter.toDownloadUrl(mockPurl as any)

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
})
