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
 * @fileoverview URL conversion utilities for converting Package URLs to repository and download URLs.
 */
import type { PackageURL } from './package-url.js'

/**
 * Repository URL conversion results.
 *
 * This interface represents the result of converting a PackageURL to a
 * repository URL where the source code can be found.
 */
export interface RepositoryUrl {
  /** The type of repository (version control system or web interface). */
  type: 'git' | 'hg' | 'svn' | 'web'
  /** The repository URL string. */
  url: string
}

/**
 * Download URL conversion results.
 *
 * This interface represents the result of converting a PackageURL to a
 * download URL where the package artifact can be obtained.
 */
export interface DownloadUrl {
  /** The type/format of the downloadable artifact. */
  type: 'tarball' | 'zip' | 'exe' | 'wheel' | 'jar' | 'gem' | 'other'
  /** The download URL string. */
  url: string
}

/**
 * URL conversion utilities for Package URLs.
 *
 * This class provides static methods for converting PackageURL instances into
 * various types of URLs, including repository URLs for source code access and
 * download URLs for package artifacts. It supports many popular package ecosystems.
 *
 * @example
 * ```typescript
 * const purl = PackageURL.fromString('pkg:npm/lodash@4.17.21')
 * const repoUrl = UrlConverter.toRepositoryUrl(purl)
 * const downloadUrl = UrlConverter.toDownloadUrl(purl)
 * ```
 */
export class UrlConverter {
  /**
   * Convert a PackageURL to a repository URL if possible.
   *
   * This method attempts to generate a repository URL where the package's
   * source code can be found. Different package types use different URL
   * patterns and repository hosting services.
   */
  static toRepositoryUrl(purl: PackageURL): RepositoryUrl | null {
    const { name, namespace, type } = purl

    switch (type) {
      case 'npm':
        return {
          type: 'web',
          url: `https://npmjs.com/package/${namespace ? `${namespace}/` : ''}${name}`,
        }

      case 'pypi':
        return {
          type: 'web',
          url: `https://pypi.org/project/${name}/`,
        }

      case 'maven': {
        if (!namespace) {
          return null
        }
        const groupPath = namespace.replace(/\./g, '/')
        return {
          type: 'web',
          url: `https://repo1.maven.org/maven2/${groupPath}/${name}/`,
        }
      }

      case 'gem':
        return {
          type: 'web',
          url: `https://rubygems.org/gems/${name}`,
        }

      case 'golang':
        if (!namespace) {
          return null
        }
        return {
          type: 'git',
          url: `https://${namespace}/${name}`,
        }

      case 'cargo':
        return {
          type: 'web',
          url: `https://crates.io/crates/${name}`,
        }

      case 'nuget':
        return {
          type: 'web',
          url: `https://nuget.org/packages/${name}/`,
        }

      case 'composer':
        return {
          type: 'web',
          url: `https://packagist.org/packages/${namespace ? `${namespace}/` : ''}${name}`,
        }

      case 'github':
        if (!namespace) {
          return null
        }
        return {
          type: 'git',
          url: `https://github.com/${namespace}/${name}`,
        }

      case 'gitlab':
        if (!namespace) {
          return null
        }
        return {
          type: 'git',
          url: `https://gitlab.com/${namespace}/${name}`,
        }

      case 'bitbucket':
        if (!namespace) {
          return null
        }
        return {
          type: 'git',
          url: `https://bitbucket.org/${namespace}/${name}`,
        }

      case 'hex':
        return {
          type: 'web',
          url: `https://hex.pm/packages/${name}`,
        }

      case 'pub':
        return {
          type: 'web',
          url: `https://pub.dev/packages/${name}`,
        }

      case 'luarocks':
        return {
          type: 'web',
          url: `https://luarocks.org/modules/${namespace ? `${namespace}/` : ''}${name}`,
        }

      default:
        return null
    }
  }

  /**
   * Convert a PackageURL to a download URL if possible.
   *
   * This method attempts to generate a download URL where the package's
   * artifact (binary, archive, etc.) can be obtained. Requires a version
   * to be present in the PackageURL.
   */
  static toDownloadUrl(purl: PackageURL): DownloadUrl | null {
    const { name, namespace, type, version } = purl

    if (!version) {
      return null
    }

    switch (type) {
      case 'npm': {
        const npmName = namespace ? `${namespace}/${name}` : name
        return {
          type: 'tarball',
          url: `https://registry.npmjs.org/${npmName}/-/${name}-${version}.tgz`,
        }
      }

      case 'pypi':
        return {
          type: 'wheel',
          url: `https://pypi.org/simple/${name}/`,
        }

      case 'maven': {
        if (!namespace) {
          return null
        }
        const groupPath = namespace.replace(/\./g, '/')
        return {
          type: 'jar',
          url: `https://repo1.maven.org/maven2/${groupPath}/${name}/${version}/${name}-${version}.jar`,
        }
      }

      case 'gem':
        return {
          type: 'gem',
          url: `https://rubygems.org/downloads/${name}-${version}.gem`,
        }

      case 'cargo':
        return {
          type: 'tarball',
          url: `https://crates.io/api/v1/crates/${name}/${version}/download`,
        }

      case 'nuget':
        return {
          type: 'zip',
          url: `https://nuget.org/packages/${name}/${version}/download`,
        }

      case 'composer':
        if (!namespace) {
          return null
        }
        return {
          type: 'other',
          url: `https://repo.packagist.org/p2/${namespace}/${name}.json`,
        }

      case 'hex':
        return {
          type: 'tarball',
          url: `https://repo.hex.pm/tarballs/${name}-${version}.tar`,
        }

      case 'pub':
        return {
          type: 'tarball',
          url: `https://pub.dev/packages/${name}/versions/${version}.tar.gz`,
        }

      case 'golang':
        if (!namespace) {
          return null
        }
        return {
          type: 'zip',
          url: `https://proxy.golang.org/${namespace}/${name}/@v/${version}.zip`,
        }

      default:
        return null
    }
  }

  /**
   * Get all available URLs for a PackageURL.
   *
   * This convenience method returns both repository and download URLs
   * in a single call, useful when you need to check all URL options.
   */
  static getAllUrls(purl: PackageURL): {
    download: DownloadUrl | null
    repository: RepositoryUrl | null
  } {
    return {
      download: this.toDownloadUrl(purl),
      repository: this.toRepositoryUrl(purl),
    }
  }

  /**
   * Check if a PackageURL type supports repository URL conversion.
   *
   * This method checks if the given package type has repository URL
   * conversion logic implemented.
   */
  static supportsRepositoryUrl(type: string): boolean {
    const supportedTypes = [
      'npm',
      'pypi',
      'maven',
      'gem',
      'golang',
      'cargo',
      'nuget',
      'composer',
      'github',
      'gitlab',
      'bitbucket',
      'hex',
      'pub',
      'luarocks',
    ]
    return supportedTypes.includes(type)
  }

  /**
   * Check if a PackageURL type supports download URL conversion.
   *
   * This method checks if the given package type has download URL
   * conversion logic implemented.
   */
  static supportsDownloadUrl(type: string): boolean {
    const supportedTypes = [
      'npm',
      'pypi',
      'maven',
      'gem',
      'cargo',
      'nuget',
      'composer',
      'hex',
      'pub',
      'golang',
    ]
    return supportedTypes.includes(type)
  }
}
