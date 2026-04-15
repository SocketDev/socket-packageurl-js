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
import {
  ArrayPrototypeFilter,
  ArrayPrototypeJoin,
  ArrayPrototypeSlice,
  MapCtor,
  ObjectFreeze,
  SetCtor,
  StringPrototypeCharCodeAt,
  StringPrototypeEndsWith,
  StringPrototypeIndexOf,
  StringPrototypeLastIndexOf,
  StringPrototypeReplace,
  StringPrototypeSlice,
  StringPrototypeSplit,
  StringPrototypeStartsWith,
  URLCtor,
} from './primordials.js'

import type { PackageURL } from './package-url.js'

// Lazy reference to PackageURL, set by package-url.ts at module load time
// to avoid circular import issues.
let _PackageURL: typeof PackageURL | undefined

/** @internal Register the PackageURL class for fromUrl construction. */
export function _registerPackageURLForUrlConverter(
  ctor: typeof PackageURL,
): void {
  _PackageURL = ctor
}

type UrlParser = (_url: URL) => PackageURL | undefined

/**
 * Filter empty segments from a URL pathname split.
 * Trailing slashes create empty segments that must be removed.
 */
function filterSegments(pathname: string): string[] {
  return ArrayPrototypeFilter(
    StringPrototypeSplit(pathname, '/' as any),
    s => s.length > 0,
  )
}

/**
 * Safely construct a PackageURL, returning undefined if construction fails.
 */
function tryCreatePurl(
  type: string,
  namespace: string | undefined,
  name: string,
  version: string | undefined,
): PackageURL | undefined {
  /* v8 ignore next 3 -- PackageURL is always registered at module load time. */
  if (!_PackageURL) {
    return undefined
  }
  try {
    return new _PackageURL(type, namespace, name, version, undefined, undefined)
  } catch {
    /* v8 ignore next -- Defensive: validation error in PackageURL constructor. */
    return undefined
  }
}

/**
 * Parse npm registry URLs (registry.npmjs.org).
 *
 * Handles:
 * - Registry metadata: /\@scope/name or /name
 * - Registry metadata with version: /\@scope/name/version or /name/version
 * - Download tarballs: /\@scope/name/-/name-version.tgz or /name/-/name-version.tgz
 */
function parseNpmRegistry(url: URL): PackageURL | undefined {
  const segments = filterSegments(url.pathname)
  if (segments.length === 0) {
    return undefined
  }

  let namespace: string | undefined
  let name: string | undefined
  let version: string | undefined

  // Scoped package: first segment starts with @
  if (segments[0] && StringPrototypeStartsWith(segments[0], '@')) {
    namespace = segments[0]
    name = segments[1]
    if (!name) {
      return undefined
    }
    // Download tarball: /@scope/name/-/name-version.tgz
    if (segments[2] === '-' && segments[3]) {
      const tgz = segments[3]
      if (StringPrototypeEndsWith(tgz, '.tgz')) {
        const withoutExt = StringPrototypeSlice(tgz, 0, -4)
        // name-version pattern: find last hyphen after name
        const prefix = `${name}-`
        if (StringPrototypeStartsWith(withoutExt, prefix)) {
          version = StringPrototypeSlice(withoutExt, prefix.length)
        }
      }
    } else if (segments[2]) {
      version = segments[2]
    }
  } else {
    name = segments[0]
    /* v8 ignore next 3 -- Defensive: filterSegments ensures non-empty. */
    if (!name) {
      return undefined
    }
    // Download tarball: /name/-/name-version.tgz
    if (segments[1] === '-' && segments[2]) {
      const tgz = segments[2]
      if (StringPrototypeEndsWith(tgz, '.tgz')) {
        const withoutExt = StringPrototypeSlice(tgz, 0, -4)
        const prefix = `${name}-`
        if (StringPrototypeStartsWith(withoutExt, prefix)) {
          version = StringPrototypeSlice(withoutExt, prefix.length)
        }
      }
    } else if (segments[1]) {
      version = segments[1]
    }
  }

  return tryCreatePurl('npm', namespace, name, version)
}

/**
 * Parse npm website URLs (www.npmjs.com).
 *
 * Handles:
 * - /package/\@scope/name, /package/\@scope/name/v/version
 * - /package/name, /package/name/v/version
 */
function parseNpmWebsite(url: URL): PackageURL | undefined {
  const segments = filterSegments(url.pathname)
  if (segments.length === 0 || segments[0] !== 'package') {
    return undefined
  }

  let namespace: string | undefined
  let name: string | undefined
  let version: string | undefined

  if (segments[1] && StringPrototypeStartsWith(segments[1], '@')) {
    namespace = segments[1]
    name = segments[2]
    if (!name) {
      return undefined
    }
    if (segments[3] === 'v' && segments[4]) {
      version = segments[4]
    }
  } else {
    name = segments[1]
    if (!name) {
      return undefined
    }
    if (segments[2] === 'v' && segments[3]) {
      version = segments[3]
    }
  }

  return tryCreatePurl('npm', namespace, name, version)
}

/**
 * Parse PyPI URLs (pypi.org).
 *
 * Handles: /project/name/, /project/name/version/
 */
function parsePypi(url: URL): PackageURL | undefined {
  const segments = filterSegments(url.pathname)
  if (segments.length < 2 || segments[0] !== 'project') {
    return undefined
  }

  const name = segments[1]
  /* v8 ignore next 3 -- Defensive: filterSegments ensures non-empty. */
  if (!name) {
    return undefined
  }
  const version = segments[2]

  return tryCreatePurl('pypi', undefined, name, version)
}

/**
 * Parse Maven Central URLs (repo1.maven.org).
 *
 * Handles: /maven2/{group-as-path}/{artifact}/{version}/
 * Group path segments are joined with '.'.
 */
function parseMaven(url: URL): PackageURL | undefined {
  const segments = filterSegments(url.pathname)
  // Minimum: maven2 / groupPart / artifact / version
  if (segments.length < 4 || segments[0] !== 'maven2') {
    return undefined
  }

  // Remove 'maven2' prefix
  const parts = ArrayPrototypeSlice(segments, 1)
  // Last segment is version, second-to-last is artifact, rest is group path
  if (parts.length < 3) {
    /* v8 ignore next -- Defensive: filterSegments ensures non-empty. */
    return undefined
  }
  const version = parts[parts.length - 1]!
  const name = parts[parts.length - 2]!
  const groupParts = ArrayPrototypeSlice(parts, 0, -2)
  const namespace = ArrayPrototypeJoin(groupParts, '.')

  if (!namespace || !name) {
    /* v8 ignore next -- Defensive: filterSegments ensures non-empty. */
    return undefined
  }

  return tryCreatePurl('maven', namespace, name, version)
}

/**
 * Parse RubyGems URLs (rubygems.org).
 *
 * Handles: /gems/name, /gems/name/versions/version
 */
function parseGem(url: URL): PackageURL | undefined {
  const segments = filterSegments(url.pathname)
  if (segments.length < 2 || segments[0] !== 'gems') {
    return undefined
  }

  const name = segments[1]
  /* v8 ignore next 3 -- Defensive: filterSegments ensures non-empty. */
  if (!name) {
    return undefined
  }

  let version: string | undefined
  if (segments[2] === 'versions' && segments[3]) {
    version = segments[3]
  }

  return tryCreatePurl('gem', undefined, name, version)
}

/**
 * Parse crates.io URLs.
 *
 * Handles:
 * - /crates/name, /crates/name/version
 * - /api/v1/crates/name/version/download
 */
function parseCargo(url: URL): PackageURL | undefined {
  const segments = filterSegments(url.pathname)
  if (segments.length < 2) {
    return undefined
  }

  // /api/v1/crates/name/version/download
  if (
    segments[0] === 'api' &&
    segments[1] === 'v1' &&
    segments[2] === 'crates' &&
    segments[3]
  ) {
    const name = segments[3]
    const version = segments[4]
    return tryCreatePurl('cargo', undefined, name, version)
  }

  // /crates/name or /crates/name/version
  if (segments[0] !== 'crates') {
    return undefined
  }

  const name = segments[1]
  /* v8 ignore next 3 -- Defensive: filterSegments ensures non-empty. */
  if (!name) {
    return undefined
  }
  const version = segments[2]

  return tryCreatePurl('cargo', undefined, name, version)
}

/**
 * Parse NuGet URLs (www.nuget.org and api.nuget.org).
 *
 * Handles:
 * - www.nuget.org: /packages/Name, /packages/Name/version
 * - api.nuget.org: /v3-flatcontainer/name/version/name.version.nupkg
 */
function parseNuget(url: URL): PackageURL | undefined {
  const segments = filterSegments(url.pathname)
  if (segments.length < 2) {
    return undefined
  }

  // api.nuget.org: /v3-flatcontainer/name/version/name.version.nupkg
  if (url.hostname === 'api.nuget.org') {
    if (segments[0] !== 'v3-flatcontainer' || !segments[1]) {
      return undefined
    }
    const name = segments[1]
    const version = segments[2]
    return tryCreatePurl('nuget', undefined, name, version)
  }

  // www.nuget.org: /packages/Name or /packages/Name/version
  if (segments[0] !== 'packages') {
    return undefined
  }

  const name = segments[1]
  /* v8 ignore next 3 -- Defensive: filterSegments ensures non-empty. */
  if (!name) {
    return undefined
  }
  const version = segments[2]

  return tryCreatePurl('nuget', undefined, name, version)
}

/**
 * Parse GitHub URLs (github.com).
 *
 * Handles:
 * - /owner/repo
 * - /owner/repo/tree/ref
 * - /owner/repo/commit/sha
 * - /owner/repo/releases/tag/tagname
 */
function parseGitHub(url: URL): PackageURL | undefined {
  const segments = filterSegments(url.pathname)
  if (segments.length < 2) {
    return undefined
  }

  const namespace = segments[0]!
  const name = segments[1]!

  let version: string | undefined
  if (segments[2] === 'tree' && segments[3]) {
    version = segments[3]
  } else if (segments[2] === 'commit' && segments[3]) {
    version = segments[3]
  } else if (
    segments[2] === 'releases' &&
    segments[3] === 'tag' &&
    segments[4]
  ) {
    version = segments[4]
  }

  return tryCreatePurl('github', namespace, name, version)
}

/**
 * Parse Go package URLs (pkg.go.dev).
 *
 * Handles:
 * - /module/path (e.g. /github.com/gorilla/mux)
 * - /module/path\@version (e.g. /github.com/gorilla/mux\@v1.8.0)
 */
function parseGolang(url: URL): PackageURL | undefined {
  // Remove leading slash
  let path = StringPrototypeSlice(url.pathname, 1)
  if (!path) {
    return undefined
  }

  let version: string | undefined
  // Check for @version suffix
  const atIndex = StringPrototypeLastIndexOf(path, '@')
  if (atIndex !== -1) {
    version = StringPrototypeSlice(path, atIndex + 1)
    path = StringPrototypeSlice(path, 0, atIndex)
  }

  // The full path becomes the namespace for golang purls
  // e.g. github.com/gorilla/mux -> namespace=github.com/gorilla, name=mux
  const lastSlash = StringPrototypeLastIndexOf(path, '/')
  if (lastSlash === -1) {
    return undefined
  }

  const namespace = StringPrototypeSlice(path, 0, lastSlash)
  const name = StringPrototypeSlice(path, lastSlash + 1)
  if (!namespace || !name) {
    /* v8 ignore next -- Defensive: filterSegments ensures non-empty. */
    return undefined
  }

  return tryCreatePurl('golang', namespace, name, version)
}

/**
 * Parse GitLab URLs (gitlab.com).
 * Same pattern as GitHub: /owner/repo, /owner/repo/-/tree/ref, /owner/repo/-/commit/sha
 */
function parseGitlab(url: URL): PackageURL | undefined {
  const segments = filterSegments(url.pathname)
  if (segments.length < 2) {
    return undefined
  }
  const namespace = segments[0]!
  const name = segments[1]!
  let version: string | undefined
  // GitLab uses /-/ prefix before tree/commit/tags
  if (segments[2] === '-') {
    if (segments[3] === 'tree' && segments[4]) {
      version = segments[4]
    } else if (segments[3] === 'commit' && segments[4]) {
      version = segments[4]
    } else if (segments[3] === 'tags' && segments[4]) {
      version = segments[4]
    }
  }
  return tryCreatePurl('gitlab', namespace, name, version)
}

/**
 * Parse Bitbucket URLs (bitbucket.org).
 * Pattern: /owner/repo, /owner/repo/commits/sha, /owner/repo/src/ref
 */
function parseBitbucket(url: URL): PackageURL | undefined {
  const segments = filterSegments(url.pathname)
  if (segments.length < 2) {
    return undefined
  }
  const namespace = segments[0]!
  const name = segments[1]!
  let version: string | undefined
  if (segments[2] === 'commits' && segments[3]) {
    version = segments[3]
  } else if (segments[2] === 'src' && segments[3]) {
    version = segments[3]
  }
  return tryCreatePurl('bitbucket', namespace, name, version)
}

/**
 * Parse Packagist/Composer URLs (packagist.org).
 * Pattern: /packages/namespace/name
 */
function parseComposer(url: URL): PackageURL | undefined {
  const segments = filterSegments(url.pathname)
  if (segments.length < 3 || segments[0] !== 'packages') {
    return undefined
  }
  const namespace = segments[1]!
  const name = segments[2]!
  return tryCreatePurl('composer', namespace, name, undefined)
}

/**
 * Parse Hex.pm URLs (hex.pm).
 * Pattern: /packages/name, /packages/name/version
 */
function parseHex(url: URL): PackageURL | undefined {
  const segments = filterSegments(url.pathname)
  if (segments.length < 2 || segments[0] !== 'packages') {
    return undefined
  }
  const name = segments[1]!
  const version = segments[2]
  return tryCreatePurl('hex', undefined, name, version)
}

/**
 * Parse pub.dev URLs (pub.dev).
 * Pattern: /packages/name, /packages/name/versions/version
 */
function parsePub(url: URL): PackageURL | undefined {
  const segments = filterSegments(url.pathname)
  if (segments.length < 2 || segments[0] !== 'packages') {
    return undefined
  }
  const name = segments[1]!
  let version: string | undefined
  if (segments[2] === 'versions' && segments[3]) {
    version = segments[3]
  }
  return tryCreatePurl('pub', undefined, name, version)
}

/**
 * Parse Docker Hub URLs (hub.docker.com).
 * Patterns:
 * - Official images: /\_/name
 * - User images: /r/namespace/name
 * - Library alias: /r/library/name
 */
function parseDocker(url: URL): PackageURL | undefined {
  const segments = filterSegments(url.pathname)
  if (segments.length < 2) {
    return undefined
  }
  // Official images: /_/name
  if (segments[0] === '_' && segments[1]) {
    return tryCreatePurl('docker', 'library', segments[1], undefined)
  }
  // User/org images: /r/namespace/name
  if (segments[0] === 'r' && segments[1] && segments[2]) {
    return tryCreatePurl('docker', segments[1], segments[2], undefined)
  }
  return undefined
}

/**
 * Parse CocoaPods URLs (cocoapods.org).
 * Pattern: /pods/name
 */
function parseCocoapods(url: URL): PackageURL | undefined {
  const segments = filterSegments(url.pathname)
  if (segments.length < 2 || segments[0] !== 'pods') {
    return undefined
  }
  return tryCreatePurl('cocoapods', undefined, segments[1]!, undefined)
}

/**
 * Parse Hackage URLs (hackage.haskell.org).
 * Pattern: /package/name, /package/name-version
 */
function parseHackage(url: URL): PackageURL | undefined {
  const segments = filterSegments(url.pathname)
  if (segments.length < 2 || segments[0] !== 'package') {
    return undefined
  }
  const raw = segments[1]!
  // Hackage uses name-version format in the URL
  // Find the last hyphen followed by a digit to split name from version
  let splitIndex = -1
  for (let i = raw.length - 1; i >= 0; i -= 1) {
    if (StringPrototypeCharCodeAt(raw, i) === 45 /*'-'*/) {
      const next = StringPrototypeCharCodeAt(raw, i + 1)
      // Next char is a digit (0-9)
      if (next >= 48 && next <= 57) {
        splitIndex = i
        break
      }
    }
  }
  if (splitIndex === -1) {
    return tryCreatePurl('hackage', undefined, raw, undefined)
  }
  const name = StringPrototypeSlice(raw, 0, splitIndex)
  const version = StringPrototypeSlice(raw, splitIndex + 1)
  return tryCreatePurl('hackage', undefined, name, version)
}

/**
 * Parse CRAN URLs (cran.r-project.org).
 * Pattern: /web/packages/name, /package=name (query param)
 */
function parseCran(url: URL): PackageURL | undefined {
  const segments = filterSegments(url.pathname)
  // /web/packages/name/index.html
  if (
    segments.length >= 3 &&
    segments[0] === 'web' &&
    segments[1] === 'packages'
  ) {
    return tryCreatePurl('cran', undefined, segments[2]!, undefined)
  }
  return undefined
}

/**
 * Parse Anaconda/Conda URLs (anaconda.org).
 * Pattern: /channel/name, /channel/name/version
 */
function parseConda(url: URL): PackageURL | undefined {
  const segments = filterSegments(url.pathname)
  if (segments.length < 2) {
    return undefined
  }
  // segments[0] is the channel, segments[1] is the package name
  const name = segments[1]!
  const version = segments[2]
  return tryCreatePurl('conda', undefined, name, version)
}

/**
 * Parse MetaCPAN URLs (metacpan.org).
 * Patterns: /pod/Name, /pod/Name::Sub, /dist/Name
 */
function parseCpan(url: URL): PackageURL | undefined {
  const segments = filterSegments(url.pathname)
  if (segments.length < 2) {
    return undefined
  }
  if (segments[0] === 'pod' || segments[0] === 'dist') {
    // Rejoin remaining segments for nested module names like Foo/Bar
    const name = ArrayPrototypeJoin(ArrayPrototypeSlice(segments, 1), '::')
    return tryCreatePurl('cpan', undefined, name, undefined)
  }
  return undefined
}

/**
 * Parse Hugging Face URLs (huggingface.co).
 * Pattern: /namespace/name, /namespace/name/tree/ref
 */
/** Reserved Hugging Face paths that are not model pages. */
const HUGGINGFACE_RESERVED = ObjectFreeze(
  new SetCtor([
    'docs',
    'spaces',
    'datasets',
    'tasks',
    'blog',
    'pricing',
    'join',
    'login',
    'settings',
    'api',
  ]),
)

function parseHuggingface(url: URL): PackageURL | undefined {
  const segments = filterSegments(url.pathname)
  if (segments.length < 2) {
    return undefined
  }
  // Skip non-model paths (docs, spaces UI, etc.)
  if (HUGGINGFACE_RESERVED.has(segments[0]!)) {
    return undefined
  }
  const namespace = segments[0]!
  const name = segments[1]!
  let version: string | undefined
  if (segments[2] === 'tree' && segments[3]) {
    version = segments[3]
  } else if (segments[2] === 'commit' && segments[3]) {
    version = segments[3]
  }
  return tryCreatePurl('huggingface', namespace, name, version)
}

/**
 * Parse LuaRocks URLs (luarocks.org).
 * Pattern: /modules/namespace/name, /modules/namespace/name/version
 */
function parseLuarocks(url: URL): PackageURL | undefined {
  const segments = filterSegments(url.pathname)
  if (segments.length < 3 || segments[0] !== 'modules') {
    return undefined
  }
  const namespace = segments[1]!
  const name = segments[2]!
  const version = segments[3]
  return tryCreatePurl('luarocks', namespace, name, version)
}

/**
 * Parse Swift Package Index URLs (swiftpackageindex.com).
 * Pattern: /owner/repo
 */
function parseSwift(url: URL): PackageURL | undefined {
  const segments = filterSegments(url.pathname)
  if (segments.length < 2) {
    return undefined
  }
  return tryCreatePurl('swift', segments[0]!, segments[1]!, undefined)
}

/**
 * Parse VS Code Marketplace URLs (marketplace.visualstudio.com).
 * Pattern: /items?itemName=publisher.extension
 */
function parseVscodeMarketplace(url: URL): PackageURL | undefined {
  const segments = filterSegments(url.pathname)
  if (segments.length < 1 || segments[0] !== 'items') {
    return undefined
  }
  const itemName = url.searchParams.get('itemName')
  if (!itemName) {
    return undefined
  }
  const dotIndex = StringPrototypeIndexOf(itemName, '.')
  if (dotIndex === -1 || dotIndex === 0 || dotIndex === itemName.length - 1) {
    return undefined
  }
  const namespace = StringPrototypeSlice(itemName, 0, dotIndex)
  const name = StringPrototypeSlice(itemName, dotIndex + 1)
  return tryCreatePurl('vscode-extension', namespace, name, undefined)
}

/**
 * Parse Open VSX URLs (open-vsx.org).
 * Pattern: /extension/namespace/name, /extension/namespace/name/version
 */
function parseOpenVsx(url: URL): PackageURL | undefined {
  const segments = filterSegments(url.pathname)
  if (segments.length < 3 || segments[0] !== 'extension') {
    return undefined
  }
  const namespace = segments[1]!
  const name = segments[2]!
  const version = segments[3]
  return tryCreatePurl('vscode-extension', namespace, name, version)
}

/** Hostname-based dispatch map for URL-to-PURL parsing. */
const FROM_URL_PARSERS: ReadonlyMap<string, UrlParser> = ObjectFreeze(
  new MapCtor<string, UrlParser>([
    // Package registries
    ['registry.npmjs.org', parseNpmRegistry],
    ['www.npmjs.com', parseNpmWebsite],
    ['pypi.org', parsePypi],
    ['repo1.maven.org', parseMaven],
    ['central.maven.org', parseMaven],
    ['rubygems.org', parseGem],
    ['crates.io', parseCargo],
    ['www.nuget.org', parseNuget],
    ['api.nuget.org', parseNuget],
    ['pkg.go.dev', parseGolang],
    ['hex.pm', parseHex],
    ['pub.dev', parsePub],
    ['packagist.org', parseComposer],
    ['hub.docker.com', parseDocker],
    ['cocoapods.org', parseCocoapods],
    ['hackage.haskell.org', parseHackage],
    ['cran.r-project.org', parseCran],
    ['anaconda.org', parseConda],
    ['metacpan.org', parseCpan],
    ['luarocks.org', parseLuarocks],
    ['swiftpackageindex.com', parseSwift],
    ['huggingface.co', parseHuggingface],
    // VS Code extension marketplaces
    ['marketplace.visualstudio.com', parseVscodeMarketplace],
    ['open-vsx.org', parseOpenVsx],
    // VCS hosts
    ['github.com', parseGitHub],
    ['gitlab.com', parseGitlab],
    ['bitbucket.org', parseBitbucket],
  ]),
)

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
const DOWNLOAD_URL_TYPES: ReadonlySet<string> = ObjectFreeze(
  new SetCtor([
    'cargo',
    'composer',
    'conda',
    'gem',
    'golang',
    'hex',
    'maven',
    'npm',
    'nuget',
    'pub',
    'pypi',
  ]),
)

const REPOSITORY_URL_TYPES: ReadonlySet<string> = ObjectFreeze(
  new SetCtor([
    'bioconductor',
    'bitbucket',
    'cargo',
    'chrome',
    'clojars',
    'cocoapods',
    'composer',
    'conan',
    'conda',
    'cpan',
    'deno',
    'docker',
    'elm',
    'gem',
    'github',
    'gitlab',
    'golang',
    'hackage',
    'hex',
    'homebrew',
    'huggingface',
    'luarocks',
    'maven',
    'npm',
    'nuget',
    'pub',
    'pypi',
    'swift',
    'vscode',
  ]),
)

export class UrlConverter {
  /**
   * Convert a URL string to a PackageURL if the URL is recognized.
   *
   * Dispatches to type-specific parsers based on the URL hostname.
   * Returns undefined for unrecognized hosts, invalid URLs, or URLs
   * without enough path information to construct a valid PackageURL.
   *
   * @example
   * ```typescript
   * UrlConverter.fromUrl('https://www.npmjs.com/package/lodash')
   * // -> PackageURL for pkg:npm/lodash
   *
   * UrlConverter.fromUrl('https://github.com/lodash/lodash')
   * // -> PackageURL for pkg:github/lodash/lodash
   * ```
   */
  static fromUrl(urlStr: string): PackageURL | undefined {
    let url: URL
    try {
      url = new URLCtor(urlStr)
    } catch {
      return undefined
    }
    const parser = FROM_URL_PARSERS.get(url.hostname)
    if (!parser) {
      return undefined
    }
    return parser(url)
  }

  /**
   * Check if a URL string is recognized for conversion to a PackageURL.
   *
   * Returns true if the URL's hostname has a registered parser,
   * false for invalid URLs or unrecognized hosts.
   */
  static supportsFromUrl(urlStr: string): boolean {
    let url: URL
    try {
      url = new URLCtor(urlStr)
    } catch {
      return false
    }
    return FROM_URL_PARSERS.has(url.hostname)
  }

  /**
   * Get all available URLs for a PackageURL.
   *
   * This convenience method returns both repository and download URLs
   * in a single call, useful when you need to check all URL options.
   */
  static getAllUrls(purl: PackageURL): {
    download: DownloadUrl | undefined
    repository: RepositoryUrl | undefined
  } {
    return {
      download: UrlConverter.toDownloadUrl(purl),
      repository: UrlConverter.toRepositoryUrl(purl),
    }
  }

  /**
   * Check if a PackageURL type supports download URL conversion.
   *
   * This method checks if the given package type has download URL
   * conversion logic implemented.
   */
  static supportsDownloadUrl(type: string): boolean {
    return DOWNLOAD_URL_TYPES.has(type)
  }

  /**
   * Check if a PackageURL type supports repository URL conversion.
   *
   * This method checks if the given package type has repository URL
   * conversion logic implemented.
   */
  static supportsRepositoryUrl(type: string): boolean {
    return REPOSITORY_URL_TYPES.has(type)
  }

  /**
   * Convert a PackageURL to a download URL if possible.
   *
   * This method attempts to generate a download URL where the package's
   * artifact (binary, archive, etc.) can be obtained. Requires a version
   * to be present in the PackageURL.
   */
  static toDownloadUrl(purl: PackageURL): DownloadUrl | undefined {
    const { name, namespace, type, version } = purl

    if (!version) {
      return undefined
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
          return undefined
        }
        const groupPath = StringPrototypeReplace(namespace, /\./g, '/' as any)
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
          return undefined
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

      case 'conda': {
        const channel = purl['qualifiers']?.['channel'] ?? 'conda-forge'
        return {
          type: 'tarball',
          url: `https://anaconda.org/${channel}/${name}/${version}/download`,
        }
      }

      case 'golang':
        if (!namespace) {
          return undefined
        }
        return {
          type: 'zip',
          url: `https://proxy.golang.org/${namespace}/${name}/@v/${version}.zip`,
        }

      default:
        return undefined
    }
  }

  /**
   * Convert a PackageURL to a repository URL if possible.
   *
   * This method attempts to generate a repository URL where the package's
   * source code can be found. Different package types use different URL
   * patterns and repository hosting services.
   */
  static toRepositoryUrl(purl: PackageURL): RepositoryUrl | undefined {
    const { name, namespace, type } = purl

    const { version } = purl

    switch (type) {
      case 'bioconductor':
        return {
          type: 'web',
          url: `https://bioconductor.org/packages/${name}`,
        }

      case 'bitbucket':
        if (!namespace) {
          return undefined
        }
        return {
          type: 'git',
          url: version
            ? `https://bitbucket.org/${namespace}/${name}/src/${version}`
            : `https://bitbucket.org/${namespace}/${name}`,
        }

      case 'cargo':
        return {
          type: 'web',
          url: `https://crates.io/crates/${name}`,
        }

      case 'chrome':
        return {
          type: 'web',
          url: `https://chromewebstore.google.com/detail/${name}`,
        }

      case 'clojars':
        return {
          type: 'web',
          url: `https://clojars.org/${namespace ? `${namespace}/` : ''}${name}`,
        }

      case 'cocoapods':
        return {
          type: 'web',
          url: `https://cocoapods.org/pods/${name}`,
        }

      case 'composer':
        return {
          type: 'web',
          url: `https://packagist.org/packages/${namespace ? `${namespace}/` : ''}${name}`,
        }

      case 'conan':
        return {
          type: 'web',
          url: `https://conan.io/center/recipes/${name}`,
        }

      case 'conda': {
        const channel = purl['qualifiers']?.['channel'] ?? 'conda-forge'
        return {
          type: 'web',
          url: `https://anaconda.org/${channel}/${name}`,
        }
      }

      case 'cpan':
        return {
          type: 'web',
          url: `https://metacpan.org/${namespace ? `pod/${namespace}::` : 'pod/'}${name}`,
        }

      case 'deno':
        return {
          type: 'web',
          url: version
            ? `https://deno.land/x/${name}@${version}`
            : `https://deno.land/x/${name}`,
        }

      case 'docker': {
        const versionSuffix = version ? `?tab=tags&name=${version}` : ''
        if (!namespace || namespace === 'library') {
          return {
            type: 'web',
            url: `https://hub.docker.com/_/${name}${versionSuffix}`,
          }
        }
        return {
          type: 'web',
          url: `https://hub.docker.com/r/${namespace}/${name}${versionSuffix}`,
        }
      }

      case 'elm':
        if (!namespace) {
          return undefined
        }
        return {
          type: 'web',
          url: version
            ? `https://package.elm-lang.org/packages/${namespace}/${name}/${version}`
            : `https://package.elm-lang.org/packages/${namespace}/${name}/latest`,
        }

      case 'gem':
        return {
          type: 'web',
          url: `https://rubygems.org/gems/${name}`,
        }

      case 'github':
        if (!namespace) {
          return undefined
        }
        return {
          type: 'git',
          url: version
            ? `https://github.com/${namespace}/${name}/tree/${version}`
            : `https://github.com/${namespace}/${name}`,
        }

      case 'gitlab':
        if (!namespace) {
          return undefined
        }
        return {
          type: 'git',
          url: `https://gitlab.com/${namespace}/${name}`,
        }

      case 'golang':
        if (!namespace) {
          return undefined
        }
        return {
          type: 'web',
          url: version
            ? `https://pkg.go.dev/${namespace}/${name}@${version}`
            : `https://pkg.go.dev/${namespace}/${name}`,
        }

      case 'hackage':
        return {
          type: 'web',
          url: version
            ? `https://hackage.haskell.org/package/${name}-${version}`
            : `https://hackage.haskell.org/package/${name}`,
        }

      case 'hex':
        return {
          type: 'web',
          url: `https://hex.pm/packages/${name}`,
        }

      case 'homebrew':
        return {
          type: 'web',
          url: `https://formulae.brew.sh/formula/${name}`,
        }

      case 'huggingface':
        return {
          type: 'web',
          url: `https://huggingface.co/${namespace ? `${namespace}/` : ''}${name}`,
        }

      case 'luarocks':
        return {
          type: 'web',
          url: `https://luarocks.org/modules/${namespace ? `${namespace}/` : ''}${name}`,
        }

      case 'maven': {
        if (!namespace) {
          return undefined
        }
        return {
          type: 'web',
          url: version
            ? `https://search.maven.org/artifact/${namespace}/${name}/${version}/jar`
            : `https://search.maven.org/artifact/${namespace}/${name}`,
        }
      }

      case 'npm':
        return {
          type: 'web',
          url: version
            ? `https://www.npmjs.com/package/${namespace ? `${namespace}/` : ''}${name}/v/${version}`
            : `https://www.npmjs.com/package/${namespace ? `${namespace}/` : ''}${name}`,
        }

      case 'nuget':
        return {
          type: 'web',
          url: `https://nuget.org/packages/${name}/`,
        }

      case 'pub':
        return {
          type: 'web',
          url: `https://pub.dev/packages/${name}`,
        }

      case 'pypi':
        return {
          type: 'web',
          url: `https://pypi.org/project/${name}/`,
        }

      case 'swift':
        if (!namespace) {
          return undefined
        }
        return {
          type: 'git',
          url: `https://github.com/${namespace}/${name}`,
        }

      case 'vscode':
        return {
          type: 'web',
          url: `https://marketplace.visualstudio.com/items?itemName=${namespace ? `${namespace}.` : ''}${name}`,
        }

      default:
        return undefined
    }
  }
}
