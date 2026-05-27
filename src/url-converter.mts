/* max-file-lines: table -- per-ecosystem URL conversion table; splitting per type would fragment the dispatch table. */
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

/* oxlint-disable-next-line socket/no-file-scope-oxlint-disable -- domain-grouped layout (pipeline flow / dispatch table); per-call would scatter the grouping with many redundant disables. */
/* oxlint-disable socket/sort-source-methods -- parsers grouped by ecosystem affinity (npm registry+website, github/gitlab/bitbucket) so the FROM_URL_PARSERS map below reads in the same order as the definitions. */
/**
 * @file URL conversion utilities for converting Package URLs to repository and
 *   download URLs.
 */
import {
  ArrayPrototypeFilter,
  ArrayPrototypeJoin,
  ArrayPrototypeSlice,
} from '@socketsecurity/lib/primordials/array'
import { MapCtor, SetCtor } from '@socketsecurity/lib/primordials/map-set'
import { ObjectFreeze } from '@socketsecurity/lib/primordials/object'
import { RegExpPrototypeExec } from '@socketsecurity/lib/primordials/regexp'
import {
  StringPrototypeCharCodeAt,
  StringPrototypeEndsWith,
  StringPrototypeIndexOf,
  StringPrototypeLastIndexOf,
  StringPrototypeReplace,
  StringPrototypeSlice,
  StringPrototypeSplit,
  StringPrototypeStartsWith,
} from '@socketsecurity/lib/primordials/string'
import { URLCtor } from '@socketsecurity/lib/primordials/url'

import type { PackageURL } from './package-url.mjs'

// Lazy reference to `PackageURL`, set by `package-url.ts` at module load time
// to avoid circular import issues.
let cachedPackageURL: typeof PackageURL | undefined

/**
 * @internal Register the `PackageURL` class for `fromUrl` construction.
 */
export function registerPackageURLForUrlConverter(
  ctor: typeof PackageURL,
): void {
  cachedPackageURL = ctor
}

type UrlParser = (_url: URL) => PackageURL | undefined

/**
 * Filter empty segments from a URL pathname split. Trailing slashes create
 * empty segments that must be removed.
 */
export function filterSegments(pathname: string): string[] {
  return ArrayPrototypeFilter(
    StringPrototypeSplit(pathname, '/' as any),
    s => s.length > 0,
  )
}

/**
 * Safely construct a `PackageURL`, returning `undefined` if construction fails.
 */
export function tryCreatePurl(
  type: string,
  namespace: string | undefined,
  name: string,
  version: string | undefined,
): PackageURL | undefined {
  /* v8 ignore start -- PackageURL is always registered at module load time. */
  if (!cachedPackageURL) {
    return undefined
  }
  /* v8 ignore stop */
  try {
    return new cachedPackageURL(
      type,
      namespace,
      name,
      version,
      undefined,
      undefined,
    )
  } catch {
    /* v8 ignore start -- Defensive: validation error in PackageURL constructor. */
    return undefined
    /* v8 ignore stop */
  }
}

/**
 * Shared semver-ish version capture for distribution-filename parsers. Captures
 * `major[.minor.patch...]` plus optional pre-release / build-metadata tail into
 * a `version` group. Permissive by design — distribution filenames carry more
 * shapes than strict semver (single-segment versions, build metadata with
 * hyphens, etc.).
 */
const DIST_VERSION = [
  '(?<version>',
  '\\d+(?:\\.\\d+)*', // major.minor.patch (at least major)
  '(?:', // optional pre-release / build identifier
  '(?:-+|\\.)',
  '[a-zA-Z0-9]+',
  '(?:[-.][a-zA-Z0-9]+)*',
  ')?',
  '(?:\\+[a-zA-Z0-9.]+)?', // optional build metadata
  ')',
].join('')

/**
 * Extract the pathname from a URL-or-path string. A leading `http://` or
 * `https://` scheme marks a full URL; anything else is treated as a bare path.
 * Detection is by scheme, not a bare `http` prefix — a filename like
 * `httpx-1.0.tar.gz` is a path, not a URL — and a malformed URL falls back to
 * the raw input rather than throwing.
 */
export function urlOrPathPathname(urlOrPath: string): string {
  if (
    StringPrototypeStartsWith(urlOrPath, 'http://') ||
    StringPrototypeStartsWith(urlOrPath, 'https://')
  ) {
    try {
      return new URLCtor(urlOrPath).pathname
    } catch {
      /* v8 ignore next -- Defensive: a scheme-prefixed string that still fails URL parsing. */
      return urlOrPath
    }
  }
  return urlOrPath
}

/**
 * Strip a URL or path down to its final filename segment. Distribution parsers
 * match against the bare filename, so a full URL and a bare path resolve
 * identically.
 */
export function distributionFilename(urlOrPath: string): string {
  const pathname = urlOrPathPathname(urlOrPath)
  const segments = filterSegments(pathname)
  return segments.length ? segments[segments.length - 1]! : pathname
}

/**
 * Run a `URL`-taking parser against a URL string, parsing the string first and
 * returning `undefined` if it isn't a valid URL. Lets the public static methods
 * accept strings while the internal parsers keep their `URL` signatures.
 */
export function runUrlParser(
  parser: (url: URL) => PackageURL | undefined,
  urlStr: string,
): PackageURL | undefined {
  let url: URL
  try {
    url = new URLCtor(urlStr)
  } catch {
    return undefined
  }
  return parser(url)
}

/**
 * Resolve a tarball segment's version, tolerating both the bare `name-` prefix
 * and the proxy/mirror `@scope/name-` (full scoped name) prefix that some
 * registries (Artifactory, Nexus, Verdaccio, GitHub Packages) repeat in the
 * filename. Returns the version string, or `undefined` if the segment is not a
 * recognizable `<prefix>-<version>.tgz`.
 */
export function npmTarballVersion(
  tgz: string,
  name: string,
  namespace: string | undefined,
): string | undefined {
  if (!StringPrototypeEndsWith(tgz, '.tgz')) {
    return undefined
  }
  const withoutExt = StringPrototypeSlice(tgz, 0, -4)
  // Proxy/mirror layout repeats the full scoped name: `@scope/name-version`.
  if (namespace) {
    const scopedPrefix = `${namespace}/${name}-`
    if (StringPrototypeStartsWith(withoutExt, scopedPrefix)) {
      return StringPrototypeSlice(withoutExt, scopedPrefix.length)
    }
  }
  const prefix = `${name}-`
  if (StringPrototypeStartsWith(withoutExt, prefix)) {
    return StringPrototypeSlice(withoutExt, prefix.length)
  }
  return undefined
}

/**
 * Parse npm registry URLs (`registry.npmjs.org`).
 *
 * Handles:
 *
 * - Registry metadata: `/\@scope/name` or `/name`
 * - Registry metadata with version: `/\@scope/name/version` or `/name/version`
 * - Download tarballs: `/\@scope/name/-/name-version.tgz` or
 *   `/name/-/name-version.tgz`
 * - Proxy/mirror tarballs that repeat the scoped name
 *   (`/\@scope/name/-/\@scope/name-version.tgz`) and `%2f`-encoded scope
 *   separators that yarn and some registries emit.
 */
export function fromNpmRegistryUrl(url: URL): PackageURL | undefined {
  // Yarn and some proxy registries percent-encode the scope separator
  // (`@scope%2fname`). Decode it so the scope splits into its own segment.
  const pathname = StringPrototypeReplace(
    url.pathname,
    /%2f/gi as any,
    '/' as any,
  )
  const segments = filterSegments(pathname)
  if (segments.length === 0) {
    return undefined
  }

  let namespace: string | undefined
  let name: string | undefined
  let version: string | undefined

  // Scoped package: first segment starts with `@`
  if (segments[0] && StringPrototypeStartsWith(segments[0], '@')) {
    namespace = segments[0]
    name = segments[1]
    if (!name) {
      return undefined
    }
    // Download tarball: `/@scope/name/-/name-version.tgz` (or proxy-repeated
    // `/@scope/name/-/@scope/name-version.tgz`, which decodes to a 5th segment).
    if (segments[2] === '-' && segments[3]) {
      // Proxy layout splits `@scope/name-version.tgz` across two segments once
      // `%2f` is decoded; rejoin them before matching.
      const tgz =
        segments[3] &&
        StringPrototypeStartsWith(segments[3], '@') &&
        segments[4]
          ? `${segments[3]}/${segments[4]}`
          : segments[3]
      version = npmTarballVersion(tgz, name, namespace)
    } else if (segments[2]) {
      version = segments[2]
    }
  } else {
    name = segments[0]
    /* v8 ignore start -- Defensive: filterSegments ensures non-empty. */
    if (!name) {
      return undefined
    }
    /* v8 ignore stop */
    // Download tarball: `/name/-/name-version.tgz`
    if (segments[1] === '-' && segments[2]) {
      version = npmTarballVersion(segments[2], name, undefined)
    } else if (segments[1]) {
      version = segments[1]
    }
  }

  return tryCreatePurl('npm', namespace, name, version)
}

/**
 * Parse npm website URLs (`www.npmjs.com`).
 *
 * Handles:
 *
 * - `/package/\@scope/name`, `/package/\@scope/name/v/version`
 * - `/package/name`, `/package/name/v/version`
 */
export function fromNpmSiteUrl(url: URL): PackageURL | undefined {
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
 * Parse any recognized npm URL. npm's two shapes are distinguished by hostname,
 * not path shape (`registry.npmjs.org` serves metadata / tarballs;
 * `www.npmjs.com` serves package pages), so dispatch by host — the registry
 * parser is greedy enough to misread a website path if tried blindly.
 */
export function fromNpmUrl(url: URL): PackageURL | undefined {
  if (url.hostname === 'www.npmjs.com') {
    return fromNpmSiteUrl(url)
  }
  return fromNpmRegistryUrl(url)
}

/**
 * Parse PyPI URLs (`pypi.org`).
 *
 * Handles: `/project/name/`, `/project/name/version/`
 */
export function fromPypiSiteUrl(url: URL): PackageURL | undefined {
  const segments = filterSegments(url.pathname)
  if (segments.length < 2 || segments[0] !== 'project') {
    return undefined
  }

  const name = segments[1]
  /* v8 ignore start -- Defensive: filterSegments ensures non-empty. */
  if (!name) {
    return undefined
  }
  /* v8 ignore stop */
  const version = segments[2]

  return tryCreatePurl('pypi', undefined, name, version)
}

/**
 * PyPI wheel / sdist distribution filename matcher. Captures `name` + `version`
 * from filenames like `orjson-3.11.9-cp314-cp314-manylinux_2_17_x86_64.whl`,
 * tolerating PEP 427 compound platform tags that contain dots
 * (`manylinux_2_17_x86_64.manylinux2014_x86_64`), an optional epoch (`3!1.0`),
 * and an optional trailing `.metadata` suffix.
 */
const PYPI_FILENAME = new RegExp(
  [
    '^',
    // Lazy so the name stops at the FIRST `-` that begins the version
    // (optional epoch + digit), not a later hyphen inside a build tag.
    '(?<name>[a-zA-Z0-9._-]+?)',
    '-',
    '(?<epoch>\\d+!)?',
    '(?=\\d)', // the version must start with a digit right here
    DIST_VERSION,
    '(?:-[^.]+(?:\\.[^.]+)*)?', // optional wheel tags; platform tags may contain dots
    '\\.',
    '(?:whl|tar\\.gz|zip)',
    '(?:\\.metadata)?',
    '$',
  ].join(''),
)

/**
 * Parse a PyPI distribution URL or path (a wheel / sdist filename) into a
 * `PackageURL`. Works on a bare path or a full URL.
 *
 * Handles: `…/orjson-3.11.9-cp314-…-manylinux….whl`,
 * `…/package-name-1.0.0.tar.gz`, `…/package-name-1.0.0.zip`, optionally with a
 * trailing `.metadata`.
 */
export function fromPypiDownloadUrl(urlOrPath: string): PackageURL | undefined {
  const filename = distributionFilename(urlOrPath)
  const match = RegExpPrototypeExec(PYPI_FILENAME, filename)
  if (!match?.groups) {
    return undefined
  }
  const { epoch, name } = match.groups
  /* v8 ignore start -- DIST_VERSION always captures a version group on a match. */
  if (!name || !match.groups['version']) {
    return undefined
  }
  /* v8 ignore stop */
  // Strip any post-version wheel tag (e.g. `3.11.9-cp314` → `3.11.9`), then
  // re-attach a PEP 440 epoch if present.
  const base = StringPrototypeSplit(match.groups['version'], '-' as any)[0]!
  const version = epoch ? `${epoch}${base}` : base

  return tryCreatePurl('pypi', undefined, name, version)
}

/**
 * Parse any recognized PyPI URL — project page (`pypi.org/project/…`) or a
 * distribution filename (wheel / sdist). Project-page parsing wins; the
 * distribution parser is the fallback.
 */
export function fromPypiUrl(url: URL): PackageURL | undefined {
  return fromPypiSiteUrl(url) ?? fromPypiDownloadUrl(url.href)
}

/**
 * Parse Maven Central URLs (`repo1.maven.org`).
 *
 * Handles: `/maven2/{group-as-path}/{artifact}/{version}/` Group path segments
 * are joined with `'.'`.
 */
export function fromMavenSiteUrl(url: URL): PackageURL | undefined {
  const segments = filterSegments(url.pathname)
  // Minimum: maven2 / groupPart / artifact / version
  if (segments.length < 4 || segments[0] !== 'maven2') {
    return undefined
  }

  // Remove `'maven2'` prefix
  const parts = ArrayPrototypeSlice(segments, 1)
  // Last segment is version, second-to-last is artifact, rest is group path
  /* v8 ignore start -- Defensive: the length>=4 guard above ensures parts>=3. */
  if (parts.length < 3) {
    return undefined
  }
  /* v8 ignore stop */
  const version = parts[parts.length - 1]!
  const name = parts[parts.length - 2]!
  const groupParts = ArrayPrototypeSlice(parts, 0, -2)
  const namespace = ArrayPrototypeJoin(groupParts, '.')

  /* v8 ignore start -- Defensive: filterSegments yields non-empty segments. */
  if (!namespace || !name) {
    return undefined
  }
  /* v8 ignore stop */

  return tryCreatePurl('maven', namespace, name, version)
}

/**
 * Parse RubyGems URLs (`rubygems.org`).
 *
 * Handles: `/gems/name`, `/gems/name/versions/version`
 */
export function fromGemSiteUrl(url: URL): PackageURL | undefined {
  const segments = filterSegments(url.pathname)
  if (segments.length < 2 || segments[0] !== 'gems') {
    return undefined
  }

  const name = segments[1]
  /* v8 ignore start -- Defensive: filterSegments ensures non-empty. */
  if (!name) {
    return undefined
  }
  /* v8 ignore stop */

  let version: string | undefined
  if (segments[2] === 'versions' && segments[3]) {
    version = segments[3]
  }

  return tryCreatePurl('gem', undefined, name, version)
}

/**
 * RubyGems distribution filename matchers. A direct `.gem`
 * (`/gems/name-1.2.3.gem`) and a `.gemspec.rz` under the `/quick/Marshal.x/`
 * tree, which `gem` requests over the proxy even when it bypasses the proxy for
 * the gem file itself.
 */
const GEM_FILENAME = new RegExp(
  ['^', '(?<name>[a-zA-Z0-9_-]+?)', '-', DIST_VERSION, '\\.gem$'].join(''),
)
const GEMSPEC_FILENAME = new RegExp(
  ['^', '(?<name>[a-zA-Z0-9_-]+?)', '-', DIST_VERSION, '\\.gemspec\\.rz$'].join(
    '',
  ),
)

/**
 * Parse a RubyGems distribution URL or path (`…/name-1.2.3.gem` or a
 * `…/name-1.2.3.gemspec.rz`) into a `PackageURL`.
 */
export function fromGemDownloadUrl(urlOrPath: string): PackageURL | undefined {
  const filename = distributionFilename(urlOrPath)
  const match =
    RegExpPrototypeExec(GEM_FILENAME, filename) ??
    RegExpPrototypeExec(GEMSPEC_FILENAME, filename)
  if (!match?.groups?.['name'] || !match.groups['version']) {
    return undefined
  }
  return tryCreatePurl(
    'gem',
    undefined,
    match.groups['name'],
    match.groups['version'],
  )
}

/**
 * Parse any recognized RubyGems URL — gems.org web page or a distribution
 * filename. Web-page parsing wins; the distribution parser is the fallback.
 */
export function fromGemUrl(url: URL): PackageURL | undefined {
  return fromGemSiteUrl(url) ?? fromGemDownloadUrl(url.href)
}

/**
 * Parse `crates.io` URLs.
 *
 * Handles: - `/crates/name`, `/crates/name/version` -
 * `/api/v1/crates/name/version/download`
 */
export function fromCargoSiteUrl(url: URL): PackageURL | undefined {
  const segments = filterSegments(url.pathname)
  if (segments.length < 2) {
    return undefined
  }

  // `/api/v1/crates/name/version/download`
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

  // `/crates/name` or `/crates/name/version`
  if (segments[0] !== 'crates') {
    return undefined
  }

  const name = segments[1]
  /* v8 ignore start -- Defensive: filterSegments ensures non-empty. */
  if (!name) {
    return undefined
  }
  /* v8 ignore stop */
  const version = segments[2]

  return tryCreatePurl('cargo', undefined, name, version)
}

/**
 * Parse a crates.io download path (`/crates/name/version/download`) into a
 * `PackageURL`. The site parser handles this shape when the `crates.io`
 * hostname is present; this covers the same path arriving without a host (e.g.
 * a proxy observing the bare request path).
 */
export function fromCargoDownloadUrl(
  urlOrPath: string,
): PackageURL | undefined {
  const pathname = urlOrPathPathname(urlOrPath)
  const segments = filterSegments(pathname)
  // `/crates/name/version/download`
  if (
    segments.length === 4 &&
    segments[0] === 'crates' &&
    segments[3] === 'download'
  ) {
    return tryCreatePurl('cargo', undefined, segments[1]!, segments[2])
  }
  return undefined
}

/**
 * Parse NuGet URLs (`www.nuget.org` and `api.nuget.org`).
 *
 * Handles: - `www.nuget.org`: `/packages/Name`, `/packages/Name/version` -
 * `api.nuget.org`: `/v3-flatcontainer/name/version/name.version.nupkg`
 */
export function fromNugetSiteUrl(url: URL): PackageURL | undefined {
  const segments = filterSegments(url.pathname)
  if (segments.length < 2) {
    return undefined
  }

  // `api.nuget.org`: `/v3-flatcontainer/name/version/name.version.nupkg`
  if (url.hostname === 'api.nuget.org') {
    if (segments[0] !== 'v3-flatcontainer' || !segments[1]) {
      return undefined
    }
    const name = segments[1]
    const version = segments[2]
    return tryCreatePurl('nuget', undefined, name, version)
  }

  // `www.nuget.org`: `/packages/Name` or `/packages/Name/version`
  if (segments[0] !== 'packages') {
    return undefined
  }

  const name = segments[1]
  /* v8 ignore start -- Defensive: filterSegments ensures non-empty. */
  if (!name) {
    return undefined
  }
  /* v8 ignore stop */
  const version = segments[2]

  return tryCreatePurl('nuget', undefined, name, version)
}

/**
 * Parse GitHub URLs (`github.com`).
 *
 * Handles: - `/owner/repo` - `/owner/repo/tree/ref` - `/owner/repo/commit/sha`
 * - `/owner/repo/releases/tag/tagname`
 */
export function fromGitHubUrl(url: URL): PackageURL | undefined {
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
 * Parse Go package URLs (`pkg.go.dev`).
 *
 * Handles:
 *
 * - `/module/path` (e.g. `/github.com/gorilla/mux`)
 * - `/module/path\@version` (e.g. `/github.com/gorilla/mux\@v1.8.0`)
 */
export function fromGolangSiteUrl(url: URL): PackageURL | undefined {
  // Remove leading slash
  let path = StringPrototypeSlice(url.pathname, 1)
  if (!path) {
    return undefined
  }

  let version: string | undefined
  // Check for `@version` suffix
  const atIndex = StringPrototypeLastIndexOf(path, '@')
  if (atIndex !== -1) {
    version = StringPrototypeSlice(path, atIndex + 1)
    path = StringPrototypeSlice(path, 0, atIndex)
  }

  // The full path becomes the namespace for `golang` purls
  // e.g. `github.com/gorilla/mux` -> `namespace=github.com/gorilla`, `name=mux`
  const lastSlash = StringPrototypeLastIndexOf(path, '/')
  if (lastSlash === -1) {
    return undefined
  }

  const namespace = StringPrototypeSlice(path, 0, lastSlash)
  const name = StringPrototypeSlice(path, lastSlash + 1)
  if (!namespace || !name) {
    /* v8 ignore start -- Defensive: filterSegments ensures non-empty. */
    return undefined
    /* v8 ignore stop */
  }

  return tryCreatePurl('golang', namespace, name, version)
}

/**
 * Go module proxy download matcher:
 * `/<module-path>/@v/<version>.(zip|mod|info)`. The module path may contain
 * slashes (`github.com/gorilla/mux`); the final segment is the package name,
 * the rest is the namespace. The `v` prefix is part of the captured version.
 */
const GOLANG_PROXY = new RegExp(
  [
    '^/?',
    '(?<modulePath>[^@]+?)',
    '/@v/',
    '(?<version>v[^/]+?)',
    '\\.(?:zip|mod|info)',
    '$',
  ].join(''),
)

/**
 * Parse a Go module proxy download URL or path
 * (`…/github.com/gorilla/mux/@v/v1.8.0.zip`) into a `PackageURL`.
 */
export function fromGolangDownloadUrl(
  urlOrPath: string,
): PackageURL | undefined {
  const pathname = urlOrPathPathname(urlOrPath)
  const match = RegExpPrototypeExec(GOLANG_PROXY, pathname)
  if (!match?.groups?.['modulePath'] || !match.groups['version']) {
    return undefined
  }
  const modulePath = match.groups['modulePath']
  const lastSlash = StringPrototypeLastIndexOf(modulePath, '/')
  if (lastSlash === -1) {
    return undefined
  }
  const namespace = StringPrototypeSlice(modulePath, 0, lastSlash)
  const name = StringPrototypeSlice(modulePath, lastSlash + 1)
  if (!namespace || !name) {
    return undefined
  }
  return tryCreatePurl('golang', namespace, name, match.groups['version'])
}

/**
 * Parse any recognized Go URL — pkg.go.dev page or a module-proxy download.
 * Page parsing wins; the download parser is the fallback.
 */
export function fromGolangUrl(url: URL): PackageURL | undefined {
  return fromGolangSiteUrl(url) ?? fromGolangDownloadUrl(url.href)
}

/**
 * Parse GitLab URLs (`gitlab.com`). Same pattern as GitHub: `/owner/repo`,
 * `/owner/repo/-/tree/ref`, `/owner/repo/-/commit/sha`
 */
export function fromGitlabUrl(url: URL): PackageURL | undefined {
  const segments = filterSegments(url.pathname)
  if (segments.length < 2) {
    return undefined
  }
  const namespace = segments[0]!
  const name = segments[1]!
  let version: string | undefined
  // GitLab uses `/-/` prefix before `tree`/`commit`/`tags`
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
 * Parse Bitbucket URLs (`bitbucket.org`). Pattern: `/owner/repo`,
 * `/owner/repo/commits/sha`, `/owner/repo/src/ref`
 */
export function fromBitbucketUrl(url: URL): PackageURL | undefined {
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
 * Parse Packagist/Composer URLs (`packagist.org`). Pattern:
 * `/packages/namespace/name`
 */
export function fromComposerUrl(url: URL): PackageURL | undefined {
  const segments = filterSegments(url.pathname)
  if (segments.length < 3 || segments[0] !== 'packages') {
    return undefined
  }
  const namespace = segments[1]!
  const name = segments[2]!
  return tryCreatePurl('composer', namespace, name, undefined)
}

/**
 * Parse Hex.pm URLs (`hex.pm`). Pattern: `/packages/name`,
 * `/packages/name/version`
 */
export function fromHexUrl(url: URL): PackageURL | undefined {
  const segments = filterSegments(url.pathname)
  if (segments.length < 2 || segments[0] !== 'packages') {
    return undefined
  }
  const name = segments[1]!
  const version = segments[2]
  return tryCreatePurl('hex', undefined, name, version)
}

/**
 * Parse pub.dev URLs (`pub.dev`). Pattern: `/packages/name`,
 * `/packages/name/versions/version`
 */
export function fromPubUrl(url: URL): PackageURL | undefined {
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
 * Parse Docker Hub URLs (`hub.docker.com`). Patterns:
 *
 * - Official images: `/\_/name`
 * - User images: `/r/namespace/name`
 * - Library alias: `/r/library/name`
 */
export function fromDockerUrl(url: URL): PackageURL | undefined {
  const segments = filterSegments(url.pathname)
  if (segments.length < 2) {
    return undefined
  }
  // Official images: `/_/name`
  if (segments[0] === '_' && segments[1]) {
    return tryCreatePurl('docker', 'library', segments[1], undefined)
  }
  // User/org images: `/r/namespace/name`
  if (segments[0] === 'r' && segments[1] && segments[2]) {
    return tryCreatePurl('docker', segments[1], segments[2], undefined)
  }
  return undefined
}

/**
 * Parse CocoaPods URLs (`cocoapods.org`). Pattern: `/pods/name`
 */
export function fromCocoapodsUrl(url: URL): PackageURL | undefined {
  const segments = filterSegments(url.pathname)
  if (segments.length < 2 || segments[0] !== 'pods') {
    return undefined
  }
  return tryCreatePurl('cocoapods', undefined, segments[1]!, undefined)
}

/**
 * Parse Hackage URLs (`hackage.haskell.org`). Pattern: `/package/name`,
 * `/package/name-version`
 */
export function fromHackageUrl(url: URL): PackageURL | undefined {
  const segments = filterSegments(url.pathname)
  if (segments.length < 2 || segments[0] !== 'package') {
    return undefined
  }
  const raw = segments[1]!
  // Hackage uses `name-version` format in the URL
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
 * Parse CRAN URLs (`cran.r-project.org`). Pattern: `/web/packages/name`,
 * `/package=name` (query param)
 */
export function fromCranUrl(url: URL): PackageURL | undefined {
  const segments = filterSegments(url.pathname)
  // `/web/packages/name` or `/web/packages/name/version`. CRAN purls require a
  // version (PURL spec); a versionless web page can't form a valid purl, so
  // `tryCreatePurl` returns undefined for it.
  if (
    segments.length >= 3 &&
    segments[0] === 'web' &&
    segments[1] === 'packages'
  ) {
    const version =
      segments[3] && segments[3] !== 'index.html' ? segments[3] : undefined
    return tryCreatePurl('cran', undefined, segments[2]!, version)
  }
  return undefined
}

/**
 * Parse Anaconda/Conda URLs (`anaconda.org`). Pattern: `/channel/name`,
 * `/channel/name/version`
 */
export function fromCondaUrl(url: URL): PackageURL | undefined {
  const segments = filterSegments(url.pathname)
  if (segments.length < 2) {
    return undefined
  }
  // `segments[0]` is the channel, `segments[1]` is the package name
  const name = segments[1]!
  const version = segments[2]
  return tryCreatePurl('conda', undefined, name, version)
}

/**
 * Parse MetaCPAN URLs (`metacpan.org`). Patterns: `/pod/Name`,
 * `/pod/Name::Sub`, `/dist/Name`
 */
export function fromCpanUrl(url: URL): PackageURL | undefined {
  const segments = filterSegments(url.pathname)
  if (segments.length < 2) {
    return undefined
  }
  if (segments[0] === 'dist' || segments[0] === 'pod') {
    // Rejoin remaining segments for nested module names like `Foo/Bar`
    const name = ArrayPrototypeJoin(ArrayPrototypeSlice(segments, 1), '::')
    return tryCreatePurl('cpan', undefined, name, undefined)
  }
  return undefined
}

/**
 * Parse Hugging Face URLs (`huggingface.co`). Pattern: `/namespace/name`,
 * `/namespace/name/tree/ref`
 */
/**
 * Reserved Hugging Face paths that are not model pages.
 */
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

export function fromHuggingfaceUrl(url: URL): PackageURL | undefined {
  const segments = filterSegments(url.pathname)
  if (segments.length < 2) {
    return undefined
  }
  // Skip non-model paths (`docs`, `spaces` UI, etc.)
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
 * Parse LuaRocks URLs (`luarocks.org`). Pattern: `/modules/namespace/name`,
 * `/modules/namespace/name/version`
 */
export function fromLuarocksUrl(url: URL): PackageURL | undefined {
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
 * Parse Swift Package Index URLs (`swiftpackageindex.com`). Pattern:
 * `/owner/repo`
 */
export function fromSwiftUrl(url: URL): PackageURL | undefined {
  const segments = filterSegments(url.pathname)
  if (segments.length < 2) {
    return undefined
  }
  // Swift purls require a version (PURL spec); Swift Package Index URLs carry it
  // as an optional trailing segment (`/owner/repo/1.2.0`). Without it the purl
  // can't be constructed, so `tryCreatePurl` returns undefined.
  return tryCreatePurl('swift', segments[0]!, segments[1]!, segments[2])
}

/**
 * Parse VS Code Marketplace URLs (`marketplace.visualstudio.com`). Pattern:
 * `/items?itemName=publisher.extension`
 */
export function fromVscodeMarketplaceUrl(url: URL): PackageURL | undefined {
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
 * Parse Open VSX URLs (`open-vsx.org`). Pattern: `/extension/namespace/name`,
 * `/extension/namespace/name/version`
 */
export function fromOpenVsxUrl(url: URL): PackageURL | undefined {
  const segments = filterSegments(url.pathname)
  if (segments.length < 3 || segments[0] !== 'extension') {
    return undefined
  }
  const namespace = segments[1]!
  const name = segments[2]!
  const version = segments[3]
  return tryCreatePurl('vscode-extension', namespace, name, version)
}

/**
 * Hostname-based dispatch map for URL-to-PURL parsing.
 */
const FROM_URL_PARSERS: ReadonlyMap<string, UrlParser> = ObjectFreeze(
  new MapCtor<string, UrlParser>([
    // Package registries
    ['registry.npmjs.org', fromNpmRegistryUrl],
    ['www.npmjs.com', fromNpmSiteUrl],
    ['pypi.org', fromPypiUrl],
    ['repo1.maven.org', fromMavenSiteUrl],
    ['central.maven.org', fromMavenSiteUrl],
    ['rubygems.org', fromGemUrl],
    ['crates.io', fromCargoSiteUrl],
    ['www.nuget.org', fromNugetSiteUrl],
    ['api.nuget.org', fromNugetSiteUrl],
    ['pkg.go.dev', fromGolangUrl],
    ['hex.pm', fromHexUrl],
    ['pub.dev', fromPubUrl],
    ['packagist.org', fromComposerUrl],
    ['hub.docker.com', fromDockerUrl],
    ['cocoapods.org', fromCocoapodsUrl],
    ['hackage.haskell.org', fromHackageUrl],
    ['cran.r-project.org', fromCranUrl],
    ['anaconda.org', fromCondaUrl],
    ['metacpan.org', fromCpanUrl],
    ['luarocks.org', fromLuarocksUrl],
    ['swiftpackageindex.com', fromSwiftUrl],
    ['huggingface.co', fromHuggingfaceUrl],
    // VS Code extension marketplaces
    ['marketplace.visualstudio.com', fromVscodeMarketplaceUrl],
    ['open-vsx.org', fromOpenVsxUrl],
    // VCS hosts
    ['github.com', fromGitHubUrl],
    ['gitlab.com', fromGitlabUrl],
    ['bitbucket.org', fromBitbucketUrl],
  ]),
)

/**
 * Repository URL conversion results.
 *
 * This interface represents the result of converting a `PackageURL` to a
 * repository URL where the source code can be found.
 */
export interface RepositoryUrl {
  /**
   * The type of repository (version control system or web interface).
   */
  type: 'git' | 'hg' | 'svn' | 'web'
  /**
   * The repository URL string.
   */
  url: string
}

/**
 * Download URL conversion results.
 *
 * This interface represents the result of converting a `PackageURL` to a
 * download URL where the package artifact can be obtained.
 */
export interface DownloadUrl {
  /**
   * The type/format of the downloadable artifact.
   */
  type: 'tarball' | 'zip' | 'exe' | 'wheel' | 'jar' | 'gem' | 'other'
  /**
   * The download URL string.
   */
  url: string
}

/**
 * URL conversion utilities for Package URLs.
 *
 * This class provides static methods for converting `PackageURL` instances into
 * various types of URLs, including repository URLs for source code access and
 * download URLs for package artifacts. It supports many popular package
 * ecosystems.
 *
 * @example
 *   ;```typescript
 *   const purl = PackageURL.fromString('pkg:npm/lodash@4.17.21')
 *   const repoUrl = UrlConverter.toRepositoryUrl(purl)
 *   const downloadUrl = UrlConverter.toDownloadUrl(purl)
 *   ```
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

/**
 * Distribution-filename parsers, tried in order by `fromDownloadUrl`. Each
 * takes a bare path or full URL and returns a `PackageURL` only when the
 * filename shape matches its ecosystem.
 */
const FROM_DOWNLOAD_URL_PARSERS: ReadonlyArray<
  (urlOrPath: string) => PackageURL | undefined
> = ObjectFreeze([
  fromPypiDownloadUrl,
  fromGemDownloadUrl,
  fromGolangDownloadUrl,
  fromCargoDownloadUrl,
])

/**
 * Parse a package distribution URL or path (a registry artifact filename) into
 * a `PackageURL`, trying each ecosystem's distribution parser in turn. Works on
 * a bare path (`/packages/orjson-3.11.9-…-manylinux….whl`) or a full URL.
 */
export function fromDownloadUrl(urlOrPath: string): PackageURL | undefined {
  for (let i = 0, { length } = FROM_DOWNLOAD_URL_PARSERS; i < length; i += 1) {
    const result = FROM_DOWNLOAD_URL_PARSERS[i]!(urlOrPath)
    if (result) {
      return result
    }
  }
  return undefined
}

export class UrlConverter {
  /**
   * Convert a URL string to a `PackageURL` if the URL is recognized.
   *
   * Dispatches first by hostname (registry / web-page parsers). When no
   * hostname parser matches — an unmapped host, or a bare path with no usable
   * host — falls back to distribution-filename parsing (wheels, tarballs,
   * `.nupkg`, etc.). Hostname dispatch always wins; distribution parsing only
   * adds coverage for inputs the hostname map rejects. Returns `undefined` when
   * neither recognizes the input.
   *
   * @example
   *   ;```typescript
   *   UrlConverter.fromUrl('https://www.npmjs.com/package/lodash')
   *   // -> PackageURL for pkg:npm/lodash
   *
   *   UrlConverter.fromUrl('https://github.com/lodash/lodash')
   *   // -> PackageURL for pkg:github/lodash/lodash
   *
   *   UrlConverter.fromUrl('/packages/orjson-3.11.9-cp314-cp314-manylinux_2_17_x86_64.whl')
   *   // -> PackageURL for pkg:pypi/orjson@3.11.9 (distribution fallback)
   *   ```
   */
  static fromUrl(urlStr: string): PackageURL | undefined {
    let url: URL | undefined
    try {
      url = new URLCtor(urlStr)
    } catch {
      // Not a parseable URL — may still be a bare distribution path.
      return fromDownloadUrl(urlStr)
    }
    const parser = FROM_URL_PARSERS.get(url.hostname)
    return parser?.(url) ?? fromDownloadUrl(urlStr)
  }

  /**
   * Check if a URL string is recognized for conversion to a `PackageURL`.
   *
   * Returns `true` if the URL's hostname has a registered parser or the input
   * parses as a distribution filename, `false` otherwise.
   */
  static supportsFromUrl(urlStr: string): boolean {
    return UrlConverter.fromUrl(urlStr) !== undefined
  }

  /**
   * Parse a package distribution (download) URL or bare path — a registry
   * artifact filename such as a wheel, sdist, tarball, gem, `.nupkg`, or Go
   * module-proxy archive — into a `PackageURL`. Unlike {@link fromUrl} this does
   * not require a recognized hostname; it matches on the filename shape, so a
   * bare path resolves identically to a full URL.
   */
  static fromDownloadUrl(urlOrPath: string): PackageURL | undefined {
    return fromDownloadUrl(urlOrPath)
  }

  /**
   * Parse any recognized npm URL (registry metadata, tarball, or
   * `www.npmjs.com` page).
   */
  static fromNpmUrl(urlStr: string): PackageURL | undefined {
    return runUrlParser(fromNpmUrl, urlStr)
  }

  /**
   * Parse any recognized PyPI URL — project page or a wheel / sdist
   * distribution filename (URL or bare path).
   */
  static fromPypiUrl(urlStr: string): PackageURL | undefined {
    return runUrlParser(fromPypiSiteUrl, urlStr) ?? fromPypiDownloadUrl(urlStr)
  }

  /**
   * Parse any recognized RubyGems URL — gem page or a `.gem` / `.gemspec.rz`
   * distribution filename (URL or bare path).
   */
  static fromGemUrl(urlStr: string): PackageURL | undefined {
    return runUrlParser(fromGemSiteUrl, urlStr) ?? fromGemDownloadUrl(urlStr)
  }

  /**
   * Parse any recognized Go URL — `pkg.go.dev` page or a module-proxy download
   * (URL or bare path).
   */
  static fromGolangUrl(urlStr: string): PackageURL | undefined {
    return (
      runUrlParser(fromGolangSiteUrl, urlStr) ?? fromGolangDownloadUrl(urlStr)
    )
  }

  /**
   * Parse a crates.io URL — crate page, `/api/v1/.../download`, or a bare
   * `/crates/name/version/download` path.
   */
  static fromCargoUrl(urlStr: string): PackageURL | undefined {
    return (
      runUrlParser(fromCargoSiteUrl, urlStr) ?? fromCargoDownloadUrl(urlStr)
    )
  }

  // Per-shape leaves. The aggregators above are the usual entry points; these
  // expose the individual recognizers for callers that know the exact shape.

  /**
   * Parse an `registry.npmjs.org` metadata / tarball URL.
   */
  static fromNpmRegistryUrl(urlStr: string): PackageURL | undefined {
    return runUrlParser(fromNpmRegistryUrl, urlStr)
  }

  /**
   * Parse a `www.npmjs.com` package-page URL.
   */
  static fromNpmSiteUrl(urlStr: string): PackageURL | undefined {
    return runUrlParser(fromNpmSiteUrl, urlStr)
  }

  /**
   * Parse a `pypi.org/project/...` page URL.
   */
  static fromPypiSiteUrl(urlStr: string): PackageURL | undefined {
    return runUrlParser(fromPypiSiteUrl, urlStr)
  }

  /**
   * Parse a PyPI wheel / sdist distribution filename (URL or bare path).
   */
  static fromPypiDownloadUrl(urlOrPath: string): PackageURL | undefined {
    return fromPypiDownloadUrl(urlOrPath)
  }

  /**
   * Parse a `rubygems.org/gems/...` page URL.
   */
  static fromGemSiteUrl(urlStr: string): PackageURL | undefined {
    return runUrlParser(fromGemSiteUrl, urlStr)
  }

  /**
   * Parse a RubyGems `.gem` / `.gemspec.rz` distribution filename.
   */
  static fromGemDownloadUrl(urlOrPath: string): PackageURL | undefined {
    return fromGemDownloadUrl(urlOrPath)
  }

  /**
   * Parse a `pkg.go.dev` page URL.
   */
  static fromGolangSiteUrl(urlStr: string): PackageURL | undefined {
    return runUrlParser(fromGolangSiteUrl, urlStr)
  }

  /**
   * Parse a Go module-proxy download URL or path.
   */
  static fromGolangDownloadUrl(urlOrPath: string): PackageURL | undefined {
    return fromGolangDownloadUrl(urlOrPath)
  }

  /**
   * Parse a Maven Central `/maven2/...` URL.
   */
  static fromMavenSiteUrl(urlStr: string): PackageURL | undefined {
    return runUrlParser(fromMavenSiteUrl, urlStr)
  }

  /**
   * Parse a NuGet (`www.nuget.org` / `api.nuget.org`) URL.
   */
  static fromNugetSiteUrl(urlStr: string): PackageURL | undefined {
    return runUrlParser(fromNugetSiteUrl, urlStr)
  }

  /**
   * Parse a crates.io page / `/api/v1/.../download` URL.
   */
  static fromCargoSiteUrl(urlStr: string): PackageURL | undefined {
    return runUrlParser(fromCargoSiteUrl, urlStr)
  }

  /**
   * Parse a bare `/crates/name/version/download` path.
   */
  static fromCargoDownloadUrl(urlOrPath: string): PackageURL | undefined {
    return fromCargoDownloadUrl(urlOrPath)
  }

  // Single-shape host parsers (VCS hosts, web registries with one URL shape).

  /**
   * Parse a `github.com/owner/repo[...]` URL.
   */
  static fromGitHubUrl(urlStr: string): PackageURL | undefined {
    return runUrlParser(fromGitHubUrl, urlStr)
  }

  /**
   * Parse a `gitlab.com/owner/repo[...]` URL.
   */
  static fromGitlabUrl(urlStr: string): PackageURL | undefined {
    return runUrlParser(fromGitlabUrl, urlStr)
  }

  /**
   * Parse a `bitbucket.org/owner/repo[...]` URL.
   */
  static fromBitbucketUrl(urlStr: string): PackageURL | undefined {
    return runUrlParser(fromBitbucketUrl, urlStr)
  }

  /**
   * Parse a `packagist.org/packages/...` URL.
   */
  static fromComposerUrl(urlStr: string): PackageURL | undefined {
    return runUrlParser(fromComposerUrl, urlStr)
  }

  /**
   * Parse a `hex.pm/packages/...` URL.
   */
  static fromHexUrl(urlStr: string): PackageURL | undefined {
    return runUrlParser(fromHexUrl, urlStr)
  }

  /**
   * Parse a `pub.dev/packages/...` URL.
   */
  static fromPubUrl(urlStr: string): PackageURL | undefined {
    return runUrlParser(fromPubUrl, urlStr)
  }

  /**
   * Parse a `hub.docker.com/...` URL.
   */
  static fromDockerUrl(urlStr: string): PackageURL | undefined {
    return runUrlParser(fromDockerUrl, urlStr)
  }

  /**
   * Parse a `cocoapods.org/pods/...` URL.
   */
  static fromCocoapodsUrl(urlStr: string): PackageURL | undefined {
    return runUrlParser(fromCocoapodsUrl, urlStr)
  }

  /**
   * Parse a `hackage.haskell.org/package/...` URL.
   */
  static fromHackageUrl(urlStr: string): PackageURL | undefined {
    return runUrlParser(fromHackageUrl, urlStr)
  }

  /**
   * Parse a `cran.r-project.org/web/packages/...` URL.
   */
  static fromCranUrl(urlStr: string): PackageURL | undefined {
    return runUrlParser(fromCranUrl, urlStr)
  }

  /**
   * Parse an `anaconda.org/channel/...` URL.
   */
  static fromCondaUrl(urlStr: string): PackageURL | undefined {
    return runUrlParser(fromCondaUrl, urlStr)
  }

  /**
   * Parse a `metacpan.org/{pod,dist}/...` URL.
   */
  static fromCpanUrl(urlStr: string): PackageURL | undefined {
    return runUrlParser(fromCpanUrl, urlStr)
  }

  /**
   * Parse a `huggingface.co/namespace/name[...]` URL.
   */
  static fromHuggingfaceUrl(urlStr: string): PackageURL | undefined {
    return runUrlParser(fromHuggingfaceUrl, urlStr)
  }

  /**
   * Parse a `luarocks.org/modules/...` URL.
   */
  static fromLuarocksUrl(urlStr: string): PackageURL | undefined {
    return runUrlParser(fromLuarocksUrl, urlStr)
  }

  /**
   * Parse a `swiftpackageindex.com/owner/repo[/version]` URL.
   */
  static fromSwiftUrl(urlStr: string): PackageURL | undefined {
    return runUrlParser(fromSwiftUrl, urlStr)
  }

  /**
   * Parse a `marketplace.visualstudio.com/items?itemName=...` URL.
   */
  static fromVscodeMarketplaceUrl(urlStr: string): PackageURL | undefined {
    return runUrlParser(fromVscodeMarketplaceUrl, urlStr)
  }

  /**
   * Parse an `open-vsx.org/extension/...` URL.
   */
  static fromOpenVsxUrl(urlStr: string): PackageURL | undefined {
    return runUrlParser(fromOpenVsxUrl, urlStr)
  }

  /**
   * Get all available URLs for a `PackageURL`.
   *
   * This convenience method returns both repository and download URLs in a
   * single call, useful when you need to check all URL options.
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
   * Check if a `PackageURL` type supports download URL conversion.
   *
   * This method checks if the given package type has download URL conversion
   * logic implemented.
   */
  static supportsDownloadUrl(type: string): boolean {
    return DOWNLOAD_URL_TYPES.has(type)
  }

  /**
   * Check if a `PackageURL` type supports repository URL conversion.
   *
   * This method checks if the given package type has repository URL conversion
   * logic implemented.
   */
  static supportsRepositoryUrl(type: string): boolean {
    return REPOSITORY_URL_TYPES.has(type)
  }

  /**
   * Convert a `PackageURL` to a download URL if possible.
   *
   * This method attempts to generate a download URL where the package's
   * artifact (binary, archive, etc.) can be obtained. Requires a version to be
   * present in the `PackageURL`.
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
   * Convert a `PackageURL` to a repository URL if possible.
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
