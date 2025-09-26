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
  /** The repository URL string. */
  url: string
  /** The type of repository (version control system or web interface). */
  type: 'git' | 'hg' | 'svn' | 'web'
}

/**
 * Download URL conversion results.
 *
 * This interface represents the result of converting a PackageURL to a
 * download URL where the package artifact can be obtained.
 */
export interface DownloadUrl {
  /** The download URL string. */
  url: string
  /** The type/format of the downloadable artifact. */
  type: 'tarball' | 'zip' | 'exe' | 'wheel' | 'jar' | 'gem' | 'other'
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
          url: `https://npmjs.com/package/${namespace ? `${namespace}/` : ''}${name}`,
          type: 'web',
        }

      case 'pypi':
        return {
          url: `https://pypi.org/project/${name}/`,
          type: 'web',
        }

      case 'maven': {
        if (!namespace) {
          return null
        }
        const groupPath = namespace.replace(/\./g, '/')
        return {
          url: `https://repo1.maven.org/maven2/${groupPath}/${name}/`,
          type: 'web',
        }
      }

      case 'gem':
        return {
          url: `https://rubygems.org/gems/${name}`,
          type: 'web',
        }

      case 'golang':
        if (!namespace) {
          return null
        }
        return {
          url: `https://${namespace}/${name}`,
          type: 'git',
        }

      case 'cargo':
        return {
          url: `https://crates.io/crates/${name}`,
          type: 'web',
        }

      case 'nuget':
        return {
          url: `https://nuget.org/packages/${name}/`,
          type: 'web',
        }

      case 'composer':
        return {
          url: `https://packagist.org/packages/${namespace ? `${namespace}/` : ''}${name}`,
          type: 'web',
        }

      case 'github':
        if (!namespace) {
          return null
        }
        return {
          url: `https://github.com/${namespace}/${name}`,
          type: 'git',
        }

      case 'gitlab':
        if (!namespace) {
          return null
        }
        return {
          url: `https://gitlab.com/${namespace}/${name}`,
          type: 'git',
        }

      case 'bitbucket':
        if (!namespace) {
          return null
        }
        return {
          url: `https://bitbucket.org/${namespace}/${name}`,
          type: 'git',
        }

      case 'hex':
        return {
          url: `https://hex.pm/packages/${name}`,
          type: 'web',
        }

      case 'pub':
        return {
          url: `https://pub.dev/packages/${name}`,
          type: 'web',
        }

      case 'luarocks':
        return {
          url: `https://luarocks.org/modules/${namespace ? `${namespace}/` : ''}${name}`,
          type: 'web',
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
          url: `https://registry.npmjs.org/${npmName}/-/${name}-${version}.tgz`,
          type: 'tarball',
        }
      }

      case 'pypi':
        return {
          url: `https://pypi.org/simple/${name}/`,
          type: 'wheel',
        }

      case 'maven': {
        if (!namespace) {
          return null
        }
        const groupPath = namespace.replace(/\./g, '/')
        return {
          url: `https://repo1.maven.org/maven2/${groupPath}/${name}/${version}/${name}-${version}.jar`,
          type: 'jar',
        }
      }

      case 'gem':
        return {
          url: `https://rubygems.org/downloads/${name}-${version}.gem`,
          type: 'gem',
        }

      case 'cargo':
        return {
          url: `https://crates.io/api/v1/crates/${name}/${version}/download`,
          type: 'tarball',
        }

      case 'nuget':
        return {
          url: `https://nuget.org/packages/${name}/${version}/download`,
          type: 'zip',
        }

      case 'composer':
        if (!namespace) {
          return null
        }
        return {
          url: `https://repo.packagist.org/p2/${namespace}/${name}.json`,
          type: 'other',
        }

      case 'hex':
        return {
          url: `https://repo.hex.pm/tarballs/${name}-${version}.tar`,
          type: 'tarball',
        }

      case 'pub':
        return {
          url: `https://pub.dev/packages/${name}/versions/${version}.tar.gz`,
          type: 'tarball',
        }

      case 'golang':
        if (!namespace) {
          return null
        }
        return {
          url: `https://proxy.golang.org/${namespace}/${name}/@v/${version}.zip`,
          type: 'zip',
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
    repository: RepositoryUrl | null
    download: DownloadUrl | null
  } {
    return {
      repository: this.toRepositoryUrl(purl),
      download: this.toDownloadUrl(purl),
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
