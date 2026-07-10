# Converters

The `UrlConverter` class — convert between URLs (repository,
download, registry) and PURLs. Read this when you are turning a
human-copyable URL into a PURL, or going the other way to hand a
user a clickable download link.

## Who this is for

Contributors extending the URL ↔ PURL support to a new ecosystem,
or callers integrating Socket's data with tools that speak URL,
not PURL.

## The three directions

<!-- Box-drawing alignment note: every frame line below must
     render at exactly 66 display cells. No emoji or CJK chars
     (those are 2 cells wide in monospace). Verify widths with:
       python3 -c "import unicodedata; [print(sum(2 if unicodedata.east_asian_width(c) in ('W','F') else 1 for c in l.rstrip())) for l in open('docs/converters.md').readlines()[21:29]]"
-->

```
 ┌───────────────────────────────────────────────────────────────┐
 │   URL      -----------------fromUrl()----------->  PackageURL │
 │            <---------------toRepositoryUrl()----              │
 │            <---------------toDownloadUrl()------              │
 │                                                               │
 │            getAllUrls() returns both directions at once       │
 └───────────────────────────────────────────────────────────────┘
```

- **`UrlConverter.fromUrl(str)`** — URL string → PackageURL (or
  `undefined` if the URL is not recognized).
- **`UrlConverter.toDownloadUrl(purl)`** — PackageURL → artifact
  download URL (tarball, jar, wheel, …). Returns `undefined` if the
  type doesn't support downloads.
- **`UrlConverter.toRepositoryUrl(purl)`** — PackageURL → source
  repository URL (GitHub/GitLab/Bitbucket page or clone URL).
  Returns `undefined` if the type doesn't know its repository.
- **`UrlConverter.getAllUrls(purl)`** — convenience wrapper
  returning both download and repository URLs in one call.

All four methods are **static** on `UrlConverter`. Instances are
not needed or exposed.

## Supported hostnames for `fromUrl`

When you call `UrlConverter.fromUrl('https://github.com/lodash/lodash')`
the library dispatches on the URL's hostname. These hostnames are
registered:

| Hostname                               | Dispatches to                          |
| -------------------------------------- | -------------------------------------- |
| `registry.npmjs.org`                   | npm registry API parser                |
| `www.npmjs.com`                        | npm website parser (human-facing URLs) |
| `pypi.org`                             | pypi                                   |
| `repo1.maven.org`, `central.maven.org` | maven                                  |
| `rubygems.org`                         | gem                                    |
| `crates.io`                            | cargo                                  |
| `www.nuget.org`, `api.nuget.org`       | nuget                                  |
| `pkg.go.dev`                           | golang                                 |
| `hex.pm`                               | hex (Elixir/Erlang)                    |
| `pub.dev`                              | pub (Dart/Flutter)                     |
| `packagist.org`                        | composer (PHP)                         |
| `hub.docker.com`                       | docker                                 |
| `cocoapods.org`                        | cocoapods                              |
| `hackage.haskell.org`                  | hackage                                |
| `cran.r-project.org`                   | cran                                   |
| `anaconda.org`                         | conda                                  |
| `metacpan.org`                         | cpan                                   |
| `luarocks.org`                         | luarocks                               |
| `swiftpackageindex.com`                | swift                                  |
| `huggingface.co`                       | huggingface                            |
| `marketplace.visualstudio.com`         | vscode-extension                       |
| `open-vsx.org`                         | vscode-extension                       |
| `github.com`                           | github (repo PURL)                     |
| `gitlab.com`                           | gitlab                                 |
| `bitbucket.org`                        | bitbucket                              |

`UrlConverter.supportsFromUrl(str)` answers "is this URL
recognized?" without parsing.

## Worked examples — `fromUrl`

### npm — both registry and website

```typescript
UrlConverter.fromUrl('https://www.npmjs.com/package/lodash')
// → PackageURL('npm', undefined, 'lodash')

UrlConverter.fromUrl('https://www.npmjs.com/package/@scope/pkg')
// → PackageURL('npm', '@scope', 'pkg')

UrlConverter.fromUrl('https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz')
// → PackageURL('npm', undefined, 'lodash', '4.17.21')
```

### GitHub / GitLab / Bitbucket — VCS-style

```typescript
UrlConverter.fromUrl('https://github.com/lodash/lodash')
// → PackageURL('github', 'lodash', 'lodash')

UrlConverter.fromUrl('https://github.com/lodash/lodash/tree/4.17.21')
// → PackageURL('github', 'lodash', 'lodash', '4.17.21')

UrlConverter.fromUrl('https://gitlab.com/gitlab-org/gitlab')
// → PackageURL('gitlab', 'gitlab-org', 'gitlab')
```

### Pypi

```typescript
UrlConverter.fromUrl('https://pypi.org/project/requests/')
// → PackageURL('pypi', undefined, 'requests')

UrlConverter.fromUrl('https://pypi.org/project/requests/2.31.0/')
// → PackageURL('pypi', undefined, 'requests', '2.31.0')
```

### Unrecognized host

```typescript
UrlConverter.fromUrl('https://example.com/foo/bar')
// → undefined
```

`fromUrl` never throws on unrecognized input. A caller that needs
"throw on unknown" can wrap:

```typescript
function parseOrThrow(url: string): PackageURL {
  const purl = UrlConverter.fromUrl(url)
  if (!purl) {
    throw new Error(`Unrecognized URL: ${url}`)
  }
  return purl
}
```

## Worked examples — `toDownloadUrl`

```typescript
const purl = new PackageURL('npm', undefined, 'lodash', '4.17.21')
UrlConverter.toDownloadUrl(purl)
// → { url: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz' }

const pypi = new PackageURL('pypi', undefined, 'requests', '2.31.0')
UrlConverter.toDownloadUrl(pypi)
// → { url: 'https://files.pythonhosted.org/…/requests-2.31.0.tar.gz' }
```

`toDownloadUrl` requires the PURL have a `version` — you cannot
download "some version of lodash." If version is missing, returns
`undefined`.

For ecosystems whose artifacts live at a predictable URL given
`(name, version)`, the converter returns that URL. For ecosystems
where the download requires API metadata lookup (e.g. resolving a
sha digest), the converter returns `undefined` and you will need
to use the ecosystem's own API.

## Worked examples — `toRepositoryUrl`

```typescript
const github = new PackageURL('github', 'lodash', 'lodash')
UrlConverter.toRepositoryUrl(github)
// → { type: 'git', url: 'https://github.com/lodash/lodash.git' }

const pypi = new PackageURL('pypi', undefined, 'requests')
UrlConverter.toRepositoryUrl(pypi)
// → undefined  (pypi itself doesn't expose a canonical repo URL)
```

For some ecosystems, the repository URL depends on qualifiers set
on the PURL:

```typescript
const pypiWithRepo = new PackageURL('pypi', undefined, 'requests', '2.31.0', {
  repository_url: 'https://github.com/psf/requests',
})
UrlConverter.toRepositoryUrl(pypiWithRepo)
// → { type: 'git', url: 'https://github.com/psf/requests.git' }
```

When a PURL carries a `repository_url` qualifier, the converter
prefers that over any built-in inference. The qualifier wins because
it is authoritative: the PURL author said "this is where the source
lives."

## `RepositoryUrl` and `DownloadUrl` shapes

Both converters return an object, not a bare string, so callers can
tell the kind of URL at a glance:

```typescript
interface RepositoryUrl {
  type: 'git' | 'hg' | 'svn' | 'web'
  url: string
}

interface DownloadUrl {
  url: string
  // (Some types also carry a sha/checksum field if known.)
}
```

The `type` on `RepositoryUrl` matters because `git clone <url>` is
the right command for `type: 'git'` but **not** for `type: 'svn'`
or `type: 'web'` (the latter is a browsable page, not a clone
target).

## `getAllUrls` — both in one call

```typescript
const urls = UrlConverter.getAllUrls(purl)
// → { download: DownloadUrl | undefined, repository: RepositoryUrl | undefined }
```

Use this when you are building a display (e.g. a package
information panel) and want both URLs computed together.

## Adding a new ecosystem's URL parser

The support matrix above grows when you:

1. **Add a hostname parser.** Implement a `UrlParser` function
   that takes a parsed URL and returns a `PackageURL | undefined`.
   Register it in the `FROM_URL_PARSERS` map near the top of
   `src/url-converter.ts`.
2. **Add `toDownloadUrl` support.** Add a case to the
   `toDownloadUrl` dispatch that builds the artifact URL from
   `(name, version, qualifiers)`. Add the type to
   `DOWNLOAD_URL_TYPES`.
3. **Add `toRepositoryUrl` support.** Add a case to the
   `toRepositoryUrl` dispatch. Add the type to
   `REPOSITORY_URL_TYPES`.
4. **Write tests.** Each parser needs round-trip coverage:
   `fromUrl(known)` → PURL → `toDownloadUrl(PURL)` → matches the
   input (or a canonical sibling).
5. **Run `pnpm test` and `pnpm cover`**; both must stay green with
   100% coverage.

A typical `UrlParser` looks like:

```typescript
function parseMyEcosystem(url: URL): PackageURL | undefined {
  // Extract (name, version, extras) from url.pathname / url.searchParams
  const match = /^\/packages\/([^/]+)(?:\/([^/]+))?/.exec(url.pathname)
  if (!match) {
    return undefined
  }
  const name = decodeURIComponent(match[1]!)
  const version = match[2] ? decodeURIComponent(match[2]) : undefined
  try {
    return new PackageURL('myeco', undefined, name, version)
  } catch {
    // Constructor threw — invalid shape or injection. Don't surface.
    return undefined
  }
}
```

The **try/catch** around `new PackageURL(...)` is important: a URL
parser converts unrecognized input to `undefined`, not a thrown
error. Callers distinguish "unknown URL" from "malformed PURL" by
the return type.

## Hazards and caveats

- **Hostname matching is exact.** `https://subdomain.github.com/x/y`
  is not recognized; only `github.com`. If you need
  subdomain-tolerant matching, add the variant to the registry.
- **http vs https is ignored.** The converter normalizes both to the
  same parser.
- **URL canonicalization.** `fromUrl('https://github.com/X/')` and
  `fromUrl('https://github.com/X')` produce the same PURL — trailing
  slashes are stripped. Query strings and fragments are parser-
  dependent; check the individual parser before relying on them.
- **`toDownloadUrl` + unversioned PURLs.** If your PURL has no
  `version`, download URL is `undefined`. Don't default to
  "latest" — the PURL spec treats an unversioned PURL as ambiguous,
  not as "latest."
- **Don't feed untrusted URLs without pre-validation.** `fromUrl`
  does not throw on garbage, but a very long string or a weird
  `url.pathname` can still walk a parser's path-split logic. If
  your callers are hostile, size-limit the input first.

## Further reading

- [`docs/architecture.md`](./architecture.md) — module map.
- [`docs/builders.md`](./builders.md) — the fluent API.
- [`docs/hardening.md`](./hardening.md) — injection / freeze /
  error shape, including url-converter's try/catch pattern.
- [`docs/api.md`](./api.md) — full API reference.
- [`src/url-converter.ts`](../src/url-converter.ts) — the
  implementation (~1300 lines — the biggest source file by far).
