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
 * @fileoverview Unit tests for URL-to-PURL conversion functionality.
 */
import { describe, expect, it } from 'vitest'

import { UrlConverter } from '../src/url-converter.js'

// Import PackageURL to trigger registration
import '../src/package-url.js'

describe('UrlConverter.fromUrl', () => {
  describe('npm — registry.npmjs.org', () => {
    it.each([
      [
        'https://registry.npmjs.org/@babel/core',
        'npm',
        '@babel',
        'core',
        undefined,
      ],
      [
        'https://registry.npmjs.org/@babel/core/7.0.0',
        'npm',
        '@babel',
        'core',
        '7.0.0',
      ],
      [
        'https://registry.npmjs.org/lodash',
        'npm',
        undefined,
        'lodash',
        undefined,
      ],
      [
        'https://registry.npmjs.org/lodash/4.17.21',
        'npm',
        undefined,
        'lodash',
        '4.17.21',
      ],
      [
        'https://registry.npmjs.org/@babel/core/-/core-7.0.0.tgz',
        'npm',
        '@babel',
        'core',
        '7.0.0',
      ],
      [
        'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz',
        'npm',
        undefined,
        'lodash',
        '4.17.21',
      ],
    ])(
      'should parse %s',
      (url, expectedType, expectedNamespace, expectedName, expectedVersion) => {
        const result = UrlConverter.fromUrl(url)
        expect(result).toBeDefined()
        expect(result!.type).toBe(expectedType)
        expect(result!.namespace).toBe(expectedNamespace)
        expect(result!.name).toBe(expectedName)
        expect(result!.version).toBe(expectedVersion)
      },
    )
  })

  describe('npm — www.npmjs.com', () => {
    it.each([
      [
        'https://www.npmjs.com/package/@babel/core',
        'npm',
        '@babel',
        'core',
        undefined,
      ],
      [
        'https://www.npmjs.com/package/@babel/core/v/7.0.0',
        'npm',
        '@babel',
        'core',
        '7.0.0',
      ],
      [
        'https://www.npmjs.com/package/lodash',
        'npm',
        undefined,
        'lodash',
        undefined,
      ],
      [
        'https://www.npmjs.com/package/lodash/v/4.17.21',
        'npm',
        undefined,
        'lodash',
        '4.17.21',
      ],
    ])(
      'should parse %s',
      (url, expectedType, expectedNamespace, expectedName, expectedVersion) => {
        const result = UrlConverter.fromUrl(url)
        expect(result).toBeDefined()
        expect(result!.type).toBe(expectedType)
        expect(result!.namespace).toBe(expectedNamespace)
        expect(result!.name).toBe(expectedName)
        expect(result!.version).toBe(expectedVersion)
      },
    )
  })

  describe('pypi — pypi.org', () => {
    it.each([
      ['https://pypi.org/project/requests/', 'pypi', 'requests', undefined],
      [
        'https://pypi.org/project/requests/2.28.0/',
        'pypi',
        'requests',
        '2.28.0',
      ],
      ['https://pypi.org/project/Django/', 'pypi', 'django', undefined],
    ])(
      'should parse %s',
      (url, expectedType, expectedName, expectedVersion) => {
        const result = UrlConverter.fromUrl(url)
        expect(result).toBeDefined()
        expect(result!.type).toBe(expectedType)
        expect(result!.name).toBe(expectedName)
        expect(result!.version).toBe(expectedVersion)
      },
    )
  })

  describe('maven — repo1.maven.org', () => {
    it('should parse https://repo1.maven.org/maven2/org/apache/commons/commons-lang3/3.12.0/', () => {
      const result = UrlConverter.fromUrl(
        'https://repo1.maven.org/maven2/org/apache/commons/commons-lang3/3.12.0/',
      )
      expect(result).toBeDefined()
      expect(result!.type).toBe('maven')
      expect(result!.namespace).toBe('org.apache.commons')
      expect(result!.name).toBe('commons-lang3')
      expect(result!.version).toBe('3.12.0')
    })
  })

  describe('gem — rubygems.org', () => {
    it.each([
      ['https://rubygems.org/gems/rails', 'gem', 'rails', undefined],
      [
        'https://rubygems.org/gems/rails/versions/7.0.0',
        'gem',
        'rails',
        '7.0.0',
      ],
    ])(
      'should parse %s',
      (url, expectedType, expectedName, expectedVersion) => {
        const result = UrlConverter.fromUrl(url)
        expect(result).toBeDefined()
        expect(result!.type).toBe(expectedType)
        expect(result!.name).toBe(expectedName)
        expect(result!.version).toBe(expectedVersion)
      },
    )
  })

  describe('cargo — crates.io', () => {
    it.each([
      ['https://crates.io/crates/serde', 'cargo', 'serde', undefined],
      ['https://crates.io/crates/serde/1.0.0', 'cargo', 'serde', '1.0.0'],
      [
        'https://crates.io/api/v1/crates/serde/1.0.0/download',
        'cargo',
        'serde',
        '1.0.0',
      ],
    ])(
      'should parse %s',
      (url, expectedType, expectedName, expectedVersion) => {
        const result = UrlConverter.fromUrl(url)
        expect(result).toBeDefined()
        expect(result!.type).toBe(expectedType)
        expect(result!.name).toBe(expectedName)
        expect(result!.version).toBe(expectedVersion)
      },
    )
  })

  describe('nuget — www.nuget.org and api.nuget.org', () => {
    it.each([
      [
        'https://www.nuget.org/packages/Newtonsoft.Json',
        'nuget',
        'Newtonsoft.Json',
        undefined,
      ],
      [
        'https://www.nuget.org/packages/Newtonsoft.Json/13.0.1',
        'nuget',
        'Newtonsoft.Json',
        '13.0.1',
      ],
      [
        'https://api.nuget.org/v3-flatcontainer/newtonsoft.json/13.0.1/newtonsoft.json.13.0.1.nupkg',
        'nuget',
        'newtonsoft.json',
        '13.0.1',
      ],
    ])(
      'should parse %s',
      (url, expectedType, expectedName, expectedVersion) => {
        const result = UrlConverter.fromUrl(url)
        expect(result).toBeDefined()
        expect(result!.type).toBe(expectedType)
        expect(result!.name).toBe(expectedName)
        expect(result!.version).toBe(expectedVersion)
      },
    )
  })

  describe('github — github.com', () => {
    it.each([
      [
        'https://github.com/lodash/lodash',
        'github',
        'lodash',
        'lodash',
        undefined,
      ],
      [
        'https://github.com/lodash/lodash/tree/v4.17.21',
        'github',
        'lodash',
        'lodash',
        'v4.17.21',
      ],
      [
        'https://github.com/lodash/lodash/commit/abc1234',
        'github',
        'lodash',
        'lodash',
        'abc1234',
      ],
      [
        'https://github.com/lodash/lodash/releases/tag/v4.17.21',
        'github',
        'lodash',
        'lodash',
        'v4.17.21',
      ],
    ])(
      'should parse %s',
      (url, expectedType, expectedNamespace, expectedName, expectedVersion) => {
        const result = UrlConverter.fromUrl(url)
        expect(result).toBeDefined()
        expect(result!.type).toBe(expectedType)
        expect(result!.namespace).toBe(expectedNamespace)
        expect(result!.name).toBe(expectedName)
        expect(result!.version).toBe(expectedVersion)
      },
    )
  })

  describe('golang — pkg.go.dev', () => {
    it.each([
      [
        'https://pkg.go.dev/github.com/gorilla/mux',
        'golang',
        'github.com/gorilla',
        'mux',
        undefined,
      ],
      [
        'https://pkg.go.dev/github.com/gorilla/mux@v1.8.0',
        'golang',
        'github.com/gorilla',
        'mux',
        'v1.8.0',
      ],
    ])(
      'should parse %s',
      (url, expectedType, expectedNamespace, expectedName, expectedVersion) => {
        const result = UrlConverter.fromUrl(url)
        expect(result).toBeDefined()
        expect(result!.type).toBe(expectedType)
        expect(result!.namespace).toBe(expectedNamespace)
        expect(result!.name).toBe(expectedName)
        expect(result!.version).toBe(expectedVersion)
      },
    )
  })

  describe('gitlab — gitlab.com', () => {
    it('should parse repo URL', () => {
      const p = UrlConverter.fromUrl('https://gitlab.com/inkscape/inkscape')
      expect(p?.type).toBe('gitlab')
      expect(p?.namespace).toBe('inkscape')
      expect(p?.name).toBe('inkscape')
    })

    it('should parse tree URL with version', () => {
      const p = UrlConverter.fromUrl(
        'https://gitlab.com/inkscape/inkscape/-/tree/v1.3',
      )
      expect(p?.version).toBe('v1.3')
    })

    it('should parse commit URL', () => {
      const p = UrlConverter.fromUrl(
        'https://gitlab.com/inkscape/inkscape/-/commit/abc1234',
      )
      expect(p?.version).toBe('abc1234')
    })

    it('should parse tags URL', () => {
      const p = UrlConverter.fromUrl(
        'https://gitlab.com/inkscape/inkscape/-/tags/v1.3',
      )
      expect(p?.version).toBe('v1.3')
    })

    it('should return undefined for root', () => {
      expect(UrlConverter.fromUrl('https://gitlab.com/')).toBeUndefined()
    })
  })

  describe('bitbucket — bitbucket.org', () => {
    it('should parse repo URL', () => {
      const p = UrlConverter.fromUrl(
        'https://bitbucket.org/atlassian/python-bitbucket',
      )
      expect(p?.type).toBe('bitbucket')
      expect(p?.namespace).toBe('atlassian')
      expect(p?.name).toBe('python-bitbucket')
    })

    it('should parse commits URL', () => {
      const p = UrlConverter.fromUrl(
        'https://bitbucket.org/atlassian/python-bitbucket/commits/abc1234',
      )
      expect(p?.version).toBe('abc1234')
    })

    it('should parse src URL', () => {
      const p = UrlConverter.fromUrl(
        'https://bitbucket.org/atlassian/python-bitbucket/src/v1.0',
      )
      expect(p?.version).toBe('v1.0')
    })

    it('should return undefined for root', () => {
      expect(UrlConverter.fromUrl('https://bitbucket.org/')).toBeUndefined()
    })
  })

  describe('composer — packagist.org', () => {
    it('should parse package URL', () => {
      const p = UrlConverter.fromUrl(
        'https://packagist.org/packages/symfony/console',
      )
      expect(p?.type).toBe('composer')
      expect(p?.namespace).toBe('symfony')
      expect(p?.name).toBe('console')
    })

    it('should return undefined for non-packages path', () => {
      expect(
        UrlConverter.fromUrl('https://packagist.org/explore'),
      ).toBeUndefined()
    })

    it('should return undefined without namespace and name', () => {
      expect(
        UrlConverter.fromUrl('https://packagist.org/packages'),
      ).toBeUndefined()
    })
  })

  describe('hex — hex.pm', () => {
    it('should parse package URL', () => {
      const p = UrlConverter.fromUrl('https://hex.pm/packages/phoenix')
      expect(p?.type).toBe('hex')
      expect(p?.name).toBe('phoenix')
    })

    it('should parse package with version', () => {
      const p = UrlConverter.fromUrl('https://hex.pm/packages/phoenix/1.7.0')
      expect(p?.version).toBe('1.7.0')
    })

    it('should return undefined for non-packages path', () => {
      expect(UrlConverter.fromUrl('https://hex.pm/docs')).toBeUndefined()
    })
  })

  describe('pub — pub.dev', () => {
    it('should parse package URL', () => {
      const p = UrlConverter.fromUrl('https://pub.dev/packages/flutter_bloc')
      expect(p?.type).toBe('pub')
      expect(p?.name).toBe('flutter_bloc')
    })

    it('should parse package with version', () => {
      const p = UrlConverter.fromUrl(
        'https://pub.dev/packages/flutter_bloc/versions/8.1.0',
      )
      expect(p?.version).toBe('8.1.0')
    })

    it('should return undefined for non-packages path', () => {
      expect(UrlConverter.fromUrl('https://pub.dev/topics')).toBeUndefined()
    })
  })

  describe('docker — hub.docker.com', () => {
    it('should parse official image URL', () => {
      const p = UrlConverter.fromUrl('https://hub.docker.com/_/nginx')
      expect(p?.type).toBe('docker')
      expect(p?.namespace).toBe('library')
      expect(p?.name).toBe('nginx')
    })

    it('should parse user image URL', () => {
      const p = UrlConverter.fromUrl(
        'https://hub.docker.com/r/bitnami/postgresql',
      )
      expect(p?.type).toBe('docker')
      expect(p?.namespace).toBe('bitnami')
      expect(p?.name).toBe('postgresql')
    })

    it('should return undefined for root', () => {
      expect(UrlConverter.fromUrl('https://hub.docker.com/')).toBeUndefined()
    })

    it('should return undefined for unrecognized path', () => {
      expect(
        UrlConverter.fromUrl('https://hub.docker.com/search'),
      ).toBeUndefined()
    })
  })

  describe('cocoapods — cocoapods.org', () => {
    it('should parse pod URL', () => {
      const p = UrlConverter.fromUrl('https://cocoapods.org/pods/Alamofire')
      expect(p?.type).toBe('cocoapods')
      expect(p?.name).toBe('Alamofire')
    })

    it('should return undefined for non-pods path', () => {
      expect(
        UrlConverter.fromUrl('https://cocoapods.org/about'),
      ).toBeUndefined()
    })
  })

  describe('hackage — hackage.haskell.org', () => {
    it('should parse package with version', () => {
      const p = UrlConverter.fromUrl(
        'https://hackage.haskell.org/package/aeson-2.1.0.0',
      )
      expect(p?.type).toBe('hackage')
      expect(p?.name).toBe('aeson')
      expect(p?.version).toBe('2.1.0.0')
    })

    it('should parse package without version', () => {
      const p = UrlConverter.fromUrl(
        'https://hackage.haskell.org/package/aeson',
      )
      expect(p?.name).toBe('aeson')
      expect(p?.version).toBeUndefined()
    })

    it('should return undefined for non-package path', () => {
      expect(
        UrlConverter.fromUrl('https://hackage.haskell.org/browse'),
      ).toBeUndefined()
    })
  })

  describe('cran — cran.r-project.org', () => {
    it('should return undefined for web/packages URL without version (cran requires version)', () => {
      // CRAN type requires a version component, and web URLs don't include one
      expect(
        UrlConverter.fromUrl(
          'https://cran.r-project.org/web/packages/ggplot2/index.html',
        ),
      ).toBeUndefined()
    })

    it('should return undefined for non-package path', () => {
      expect(
        UrlConverter.fromUrl('https://cran.r-project.org/mirrors.html'),
      ).toBeUndefined()
    })
  })

  describe('conda — anaconda.org', () => {
    it('should parse package URL', () => {
      const p = UrlConverter.fromUrl('https://anaconda.org/conda-forge/numpy')
      expect(p?.type).toBe('conda')
      expect(p?.name).toBe('numpy')
    })

    it('should parse package with version', () => {
      const p = UrlConverter.fromUrl(
        'https://anaconda.org/conda-forge/numpy/1.24.0',
      )
      expect(p?.version).toBe('1.24.0')
    })

    it('should return undefined for root', () => {
      expect(UrlConverter.fromUrl('https://anaconda.org/')).toBeUndefined()
    })
  })

  describe('cpan — metacpan.org', () => {
    it('should parse pod URL', () => {
      const p = UrlConverter.fromUrl('https://metacpan.org/pod/Moose')
      expect(p?.type).toBe('cpan')
      expect(p?.name).toBe('Moose')
    })

    it('should parse nested module URL', () => {
      const p = UrlConverter.fromUrl(
        'https://metacpan.org/pod/Moose/Meta/Class',
      )
      expect(p?.name).toBe('Moose::Meta::Class')
    })

    it('should parse dist URL', () => {
      const p = UrlConverter.fromUrl('https://metacpan.org/dist/Moose')
      expect(p?.name).toBe('Moose')
    })

    it('should return undefined for non-pod/dist path', () => {
      expect(UrlConverter.fromUrl('https://metacpan.org/about')).toBeUndefined()
    })
  })

  describe('huggingface — huggingface.co', () => {
    it('should parse model URL', () => {
      const p = UrlConverter.fromUrl('https://huggingface.co/microsoft/phi-2')
      expect(p?.type).toBe('huggingface')
      expect(p?.namespace).toBe('microsoft')
      expect(p?.name).toBe('phi-2')
    })

    it('should parse model with tree ref', () => {
      const p = UrlConverter.fromUrl(
        'https://huggingface.co/microsoft/phi-2/tree/main',
      )
      expect(p?.version).toBe('main')
    })

    it('should parse model with commit ref', () => {
      const p = UrlConverter.fromUrl(
        'https://huggingface.co/microsoft/phi-2/commit/abc1234',
      )
      expect(p?.version).toBe('abc1234')
    })

    it('should return undefined for reserved paths', () => {
      expect(
        UrlConverter.fromUrl('https://huggingface.co/docs/transformers'),
      ).toBeUndefined()
      expect(
        UrlConverter.fromUrl('https://huggingface.co/spaces/foo'),
      ).toBeUndefined()
    })

    it('should return undefined for root', () => {
      expect(UrlConverter.fromUrl('https://huggingface.co/')).toBeUndefined()
    })
  })

  describe('luarocks — luarocks.org', () => {
    it('should parse module URL', () => {
      const p = UrlConverter.fromUrl(
        'https://luarocks.org/modules/luarocks/luasocket',
      )
      expect(p?.type).toBe('luarocks')
      expect(p?.namespace).toBe('luarocks')
      expect(p?.name).toBe('luasocket')
    })

    it('should parse module with version', () => {
      const p = UrlConverter.fromUrl(
        'https://luarocks.org/modules/luarocks/luasocket/3.1.0',
      )
      expect(p?.version).toBe('3.1.0')
    })

    it('should return undefined for non-modules path', () => {
      expect(
        UrlConverter.fromUrl('https://luarocks.org/search'),
      ).toBeUndefined()
    })
  })

  describe('swift — swiftpackageindex.com', () => {
    it('should return undefined without version (swift requires version)', () => {
      // Swift type requires a version component
      expect(
        UrlConverter.fromUrl('https://swiftpackageindex.com/apple/swift-nio'),
      ).toBeUndefined()
    })

    it('should return undefined for root', () => {
      expect(
        UrlConverter.fromUrl('https://swiftpackageindex.com/'),
      ).toBeUndefined()
    })
  })

  describe('vscode — marketplace.visualstudio.com', () => {
    it('should parse marketplace URL', () => {
      const p = UrlConverter.fromUrl(
        'https://marketplace.visualstudio.com/items?itemName=ms-python.python',
      )
      expect(p?.type).toBe('vscode-extension')
      expect(p?.namespace).toBe('ms-python')
      expect(p?.name).toBe('python')
    })

    it('should return undefined without itemName', () => {
      expect(
        UrlConverter.fromUrl('https://marketplace.visualstudio.com/items'),
      ).toBeUndefined()
    })

    it('should return undefined for invalid itemName format', () => {
      expect(
        UrlConverter.fromUrl(
          'https://marketplace.visualstudio.com/items?itemName=noDot',
        ),
      ).toBeUndefined()
    })

    it('should return undefined for non-items path', () => {
      expect(
        UrlConverter.fromUrl('https://marketplace.visualstudio.com/manage'),
      ).toBeUndefined()
    })
  })

  describe('vscode — open-vsx.org', () => {
    it('should parse extension URL', () => {
      const p = UrlConverter.fromUrl(
        'https://open-vsx.org/extension/redhat/java',
      )
      expect(p?.type).toBe('vscode-extension')
      expect(p?.namespace).toBe('redhat')
      expect(p?.name).toBe('java')
    })

    it('should parse extension with version', () => {
      const p = UrlConverter.fromUrl(
        'https://open-vsx.org/extension/redhat/java/1.0.0',
      )
      expect(p?.version).toBe('1.0.0')
    })

    it('should return undefined for non-extension path', () => {
      expect(UrlConverter.fromUrl('https://open-vsx.org/about')).toBeUndefined()
    })
  })

  describe('unrecognized and invalid URLs', () => {
    it('should return undefined for unknown hosts', () => {
      expect(
        UrlConverter.fromUrl('https://example.com/foo/bar'),
      ).toBeUndefined()
    })

    it('should return undefined for empty string', () => {
      expect(UrlConverter.fromUrl('')).toBeUndefined()
    })

    it('should return undefined for garbage input', () => {
      expect(UrlConverter.fromUrl('not a url at all')).toBeUndefined()
    })

    it('should return undefined for URLs without enough path info', () => {
      expect(
        UrlConverter.fromUrl('https://registry.npmjs.org/'),
      ).toBeUndefined()
      expect(UrlConverter.fromUrl('https://pypi.org/')).toBeUndefined()
      expect(UrlConverter.fromUrl('https://github.com/')).toBeUndefined()
      expect(UrlConverter.fromUrl('https://github.com/lodash')).toBeUndefined()
      expect(
        UrlConverter.fromUrl('https://www.npmjs.com/package'),
      ).toBeUndefined()
    })
  })

  describe('edge cases', () => {
    it('should return undefined for npm registry root', () => {
      expect(
        UrlConverter.fromUrl('https://registry.npmjs.org/'),
      ).toBeUndefined()
    })

    it('should return undefined for npm scoped package without name', () => {
      expect(
        UrlConverter.fromUrl('https://registry.npmjs.org/@scope'),
      ).toBeUndefined()
    })

    it('should return undefined for npmjs.com without package path', () => {
      expect(UrlConverter.fromUrl('https://www.npmjs.com/')).toBeUndefined()
    })

    it('should return undefined for npmjs.com /package without name', () => {
      expect(
        UrlConverter.fromUrl('https://www.npmjs.com/package'),
      ).toBeUndefined()
    })

    it('should return undefined for npmjs.com scoped without name', () => {
      expect(
        UrlConverter.fromUrl('https://www.npmjs.com/package/@scope'),
      ).toBeUndefined()
    })

    it('should handle npm registry unscoped tarball', () => {
      const purl = UrlConverter.fromUrl(
        'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz',
      )
      expect(purl?.toString()).toBe('pkg:npm/lodash@4.17.21')
    })

    it('should handle npm registry scoped tarball', () => {
      const purl = UrlConverter.fromUrl(
        'https://registry.npmjs.org/@babel/core/-/core-7.0.0.tgz',
      )
      expect(purl?.toString()).toBe('pkg:npm/%40babel/core@7.0.0')
    })

    it('should return undefined for pypi non-project path', () => {
      expect(
        UrlConverter.fromUrl('https://pypi.org/simple/requests'),
      ).toBeUndefined()
    })

    it('should return undefined for pypi with only /project/', () => {
      expect(UrlConverter.fromUrl('https://pypi.org/project/')).toBeUndefined()
    })

    it('should return undefined for maven with too few segments', () => {
      expect(
        UrlConverter.fromUrl('https://repo1.maven.org/maven2/org/apache'),
      ).toBeUndefined()
    })

    it('should return undefined for maven non-maven2 path', () => {
      expect(
        UrlConverter.fromUrl('https://repo1.maven.org/other/path'),
      ).toBeUndefined()
    })

    it('should return undefined for rubygems non-gems path', () => {
      expect(
        UrlConverter.fromUrl('https://rubygems.org/api/v1/gems'),
      ).toBeUndefined()
    })

    it('should return undefined for rubygems /gems/ without name', () => {
      expect(UrlConverter.fromUrl('https://rubygems.org/gems/')).toBeUndefined()
    })

    it('should return undefined for crates.io root', () => {
      expect(UrlConverter.fromUrl('https://crates.io/')).toBeUndefined()
    })

    it('should return undefined for crates.io non-crates path', () => {
      expect(UrlConverter.fromUrl('https://crates.io/teams')).toBeUndefined()
    })

    it('should handle cargo API download URL', () => {
      const purl = UrlConverter.fromUrl(
        'https://crates.io/api/v1/crates/serde/1.0.0/download',
      )
      expect(purl?.toString()).toBe('pkg:cargo/serde@1.0.0')
    })

    it('should return undefined for nuget api.nuget.org non-flatcontainer', () => {
      expect(
        UrlConverter.fromUrl('https://api.nuget.org/v3/catalog/'),
      ).toBeUndefined()
    })

    it('should handle nuget API flatcontainer URL', () => {
      const purl = UrlConverter.fromUrl(
        'https://api.nuget.org/v3-flatcontainer/newtonsoft.json/13.0.1/newtonsoft.json.13.0.1.nupkg',
      )
      expect(purl?.toString()).toBe('pkg:nuget/newtonsoft.json@13.0.1')
    })

    it('should return undefined for nuget non-packages path', () => {
      expect(
        UrlConverter.fromUrl('https://www.nuget.org/profiles/user'),
      ).toBeUndefined()
    })

    it('should return undefined for github with only owner', () => {
      expect(UrlConverter.fromUrl('https://github.com/lodash')).toBeUndefined()
    })

    it('should handle github commit URL', () => {
      const purl = UrlConverter.fromUrl(
        'https://github.com/lodash/lodash/commit/abc1234',
      )
      expect(purl?.toString()).toBe('pkg:github/lodash/lodash@abc1234')
    })

    it('should handle github releases/tag URL', () => {
      const purl = UrlConverter.fromUrl(
        'https://github.com/lodash/lodash/releases/tag/v4.17.21',
      )
      expect(purl?.toString()).toBe('pkg:github/lodash/lodash@v4.17.21')
    })

    it('should return undefined for golang empty path', () => {
      expect(UrlConverter.fromUrl('https://pkg.go.dev/')).toBeUndefined()
    })

    it('should return undefined for golang single segment', () => {
      expect(UrlConverter.fromUrl('https://pkg.go.dev/fmt')).toBeUndefined()
    })

    it('should handle npm registry unscoped without version', () => {
      const purl = UrlConverter.fromUrl('https://registry.npmjs.org/lodash')
      expect(purl?.toString()).toBe('pkg:npm/lodash')
    })

    it('should handle npm website scoped with version', () => {
      const purl = UrlConverter.fromUrl(
        'https://www.npmjs.com/package/@babel/core/v/7.0.0',
      )
      expect(purl?.toString()).toBe('pkg:npm/%40babel/core@7.0.0')
    })

    it('should handle npm website unscoped without version', () => {
      const purl = UrlConverter.fromUrl('https://www.npmjs.com/package/lodash')
      expect(purl?.toString()).toBe('pkg:npm/lodash')
    })

    it('should handle pypi without version', () => {
      const purl = UrlConverter.fromUrl('https://pypi.org/project/requests/')
      expect(purl?.toString()).toBe('pkg:pypi/requests')
    })

    it('should handle gems with version', () => {
      const purl = UrlConverter.fromUrl(
        'https://rubygems.org/gems/rails/versions/7.0.0',
      )
      expect(purl?.toString()).toBe('pkg:gem/rails@7.0.0')
    })

    it('should handle cargo without version', () => {
      const purl = UrlConverter.fromUrl('https://crates.io/crates/serde')
      expect(purl?.toString()).toBe('pkg:cargo/serde')
    })

    it('should handle nuget without version', () => {
      const purl = UrlConverter.fromUrl(
        'https://www.nuget.org/packages/Newtonsoft.Json',
      )
      expect(purl?.toString()).toBe('pkg:nuget/Newtonsoft.Json')
    })

    it('should handle golang with version', () => {
      const purl = UrlConverter.fromUrl(
        'https://pkg.go.dev/github.com/gorilla/mux@v1.8.0',
      )
      expect(purl?.toString()).toBe('pkg:golang/github.com/gorilla/mux@v1.8.0')
    })

    it('should handle golang without version', () => {
      const purl = UrlConverter.fromUrl(
        'https://pkg.go.dev/github.com/gorilla/mux',
      )
      expect(purl?.toString()).toBe('pkg:golang/github.com/gorilla/mux')
    })
  })
})

describe('UrlConverter.supportsFromUrl', () => {
  it.each([
    'https://registry.npmjs.org/lodash',
    'https://www.npmjs.com/package/lodash',
    'https://pypi.org/project/requests',
    'https://github.com/lodash/lodash',
    'https://gitlab.com/inkscape/inkscape',
    'https://bitbucket.org/atlassian/repo',
    'https://pkg.go.dev/github.com/gorilla/mux',
    'https://hex.pm/packages/phoenix',
    'https://pub.dev/packages/flutter_bloc',
    'https://packagist.org/packages/symfony/console',
    'https://hub.docker.com/r/bitnami/postgresql',
    'https://cocoapods.org/pods/Alamofire',
    'https://hackage.haskell.org/package/aeson',
    'https://cran.r-project.org/web/packages/ggplot2',
    'https://anaconda.org/conda-forge/numpy',
    'https://metacpan.org/pod/Moose',
    'https://luarocks.org/modules/luarocks/luasocket',
    'https://swiftpackageindex.com/apple/swift-nio',
    'https://huggingface.co/microsoft/phi-2',
    'https://marketplace.visualstudio.com/items?itemName=ms-python.python',
    'https://open-vsx.org/extension/redhat/java',
  ])('should return true for %s', url => {
    expect(UrlConverter.supportsFromUrl(url)).toBe(true)
  })

  it('should return false for unknown hosts', () => {
    expect(UrlConverter.supportsFromUrl('https://example.com/foo')).toBe(false)
  })

  it('should return false for invalid URLs', () => {
    expect(UrlConverter.supportsFromUrl('')).toBe(false)
    expect(UrlConverter.supportsFromUrl('not a url')).toBe(false)
  })
})
