# @socketregistry/packageurl-js

[![Socket Badge](https://socket.dev/api/badge/npm/package/@socketregistry/packageurl-js)](https://socket.dev/npm/package/@socketregistry/packageurl-js)
[![CI - @socketregistry/packageurl-js](https://github.com/SocketDev/socket-packageurl-js/actions/workflows/ci.yml/badge.svg)](https://github.com/SocketDev/socket-packageurl-js/actions/workflows/ci.yml)
![Coverage](https://img.shields.io/badge/coverage-25%25-red)

[![Follow @SocketSecurity](https://img.shields.io/twitter/follow/SocketSecurity?style=social)](https://twitter.com/SocketSecurity)
[![Follow @socket.dev on Bluesky](https://img.shields.io/badge/Follow-@socket.dev-1DA1F2?style=social&logo=bluesky)](https://bsky.app/profile/socket.dev)

TypeScript Package URL (purl) parser and builder.
Drop-in replacement for [`packageurl-js`](https://socket.dev/npm/package/packageurl-js) with full type safety, zero dependencies, and spec compliance with the [Package URL specification](https://github.com/package-url/purl-spec).

## Why this repo exists

`@socketregistry/packageurl-js` is the Socket-maintained drop-in replacement for `packageurl-js` — same API, but ships with built-in TypeScript types, zero runtime dependencies, full [purl-spec](https://github.com/package-url/purl-spec) coverage, and first-class [VERS](https://github.com/package-url/vers-spec) support. It exists because the upstream package lacked types and a maintained tree-shakeable surface; this fork closes both gaps without breaking compatibility.

## What is a PURL?

A Package URL (purl) standardizes how to identify software packages:

```
pkg:npm/lodash@4.17.21
pkg:pypi/requests@2.28.1
pkg:maven/org.springframework/spring-core@5.3.21
```

**Format breakdown**:

```
  pkg:type/namespace/name@version?qualifiers#subpath
  │   │    │         │    │       │          │
  │   │    │         │    │       │          └─ Optional subpath
  │   │    │         │    │       └──────────── Optional key=value pairs
  │   │    │         │    └──────────────────── Optional version
  │   │    │         └───────────────────────── Required package name
  │   │    └─────────────────────────────────── Optional namespace/scope
  │   └──────────────────────────────────────── Required package type
  └──────────────────────────────────────────── Scheme (always "pkg:")
```

**Supports 40+ ecosystems**: npm, pypi, maven, gem, cargo, nuget, composer, golang, docker, and more.

## Features

- ✅ **Modular & tree-shakeable** - Import only what you need
- ✅ **Full TypeScript support** - Comprehensive type exports
- ✅ **Zero dependencies** - Lightweight and secure
- ✅ **Spec compliant** - Follows [purl-spec](https://github.com/package-url/purl-spec) v1.0.0, published as [ECMA-427](https://ecma-international.org/publications-and-standards/standards/ecma-427/)
- ✅ **100% test coverage** - Over 1,000 passing tests
- ✅ **Multiple APIs** - Functional, class-based, and builder patterns
- ✅ **URL conversion** - Convert to repository and download URLs
- ✅ **Registry checks** - Verify package existence across 17 registries
- ✅ **VERS support** - First-class implementation of the VERS companion spec (`Vers`, `VersConstraint`, `VersWildcard`)
- ✅ **Immutable updates** - `withVersion`, `withNamespace`, `withQualifier`, `withQualifiers`, `withSubpath`
- ✅ **Result-based parsing** - `tryFromString`, `tryFromJSON`, `tryFromObject`, `isValid`, `fromUrl`

## Install

```sh
pnpm install @socketregistry/packageurl-js
```

**Drop-in replacement** via package override:

```json
{
  "pnpm": {
    "overrides": {
      "packageurl-js": "npm:@socketregistry/packageurl-js@^1"
    }
  }
}
```

**Requirements**: Node >= 18.20.8

## Usage

### Modular Functions (Tree-shakeable)

**Parse npm specifiers:**

```javascript
import { parseNpmSpecifier } from '@socketregistry/packageurl-js'

parseNpmSpecifier('lodash@4.17.21')
// -> { namespace: undefined, name: 'lodash', version: '4.17.21' }

parseNpmSpecifier('@babel/core@^7.0.0')
// -> { namespace: '@babel', name: 'core', version: '7.0.0' }
```

**Stringify PURLs:**

```javascript
import { stringify } from '@socketregistry/packageurl-js'

stringify(purl)
// -> 'pkg:npm/lodash@4.17.21'
```

**Compare PURLs:**

```javascript
import { equals, compare } from '@socketregistry/packageurl-js'

equals(purl1, purl2) // -> boolean
compare(purl1, purl2) // -> -1 | 0 | 1
```

### Class API

**Parse and build:**

```javascript
import { PackageURL } from '@socketregistry/packageurl-js'

// Parse strings
const purl = PackageURL.fromString('pkg:npm/lodash@4.17.21')
console.log(purl.name) // 'lodash'
console.log(purl.version) // '4.17.21'

// Parse npm specifiers
PackageURL.fromNpm('lodash@4.17.21')
PackageURL.fromNpm('@babel/core@^7.0.0')

// Constructor
new PackageURL('npm', null, 'express', '4.18.2')
// -> 'pkg:npm/express@4.18.2'
```

**Builder pattern:**

```javascript
import { PurlBuilder } from '@socketregistry/packageurl-js'

PurlBuilder.npm().name('lodash').version('4.17.21').build()
// -> 'pkg:npm/lodash@4.17.21'
```

**URL conversion:**

```javascript
import { UrlConverter } from '@socketregistry/packageurl-js'

// PackageURL -> URL
UrlConverter.toRepositoryUrl(purl)
// -> 'https://github.com/lodash/lodash'

UrlConverter.toDownloadUrl(purl)
// -> 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz'

// URL -> PackageURL
UrlConverter.fromUrl('https://www.npmjs.com/package/lodash')
// -> PackageURL for pkg:npm/lodash

// fromUrl also recognizes distribution (download) URLs and bare paths
UrlConverter.fromUrl(
  '/packages/orjson-3.11.9-cp314-cp314-manylinux_2_17_x86_64.whl',
)
// -> PackageURL for pkg:pypi/orjson@3.11.9
```

`fromUrl` tries hostname-based parsers first, then falls back to
distribution-filename parsing. The individual parsers are also exposed when you
know the shape:

```javascript
// Per-ecosystem aggregators (try the ecosystem's known URL shapes)
UrlConverter.fromNpmUrl(url) // registry metadata/tarball or npmjs.com page
UrlConverter.fromPypiUrl(url) // project page or wheel/sdist filename
UrlConverter.fromGemUrl(url) // gem page or .gem / .gemspec.rz
UrlConverter.fromGolangUrl(url) // pkg.go.dev page or module-proxy archive
UrlConverter.fromCargoUrl(url) // crate page or download path

// Distribution (download) URLs/paths, host-independent
UrlConverter.fromDownloadUrl(
  '/packages/numpy-2.3.0-cp313-cp313-macosx_11_0_arm64.whl',
)
// -> PackageURL for pkg:pypi/numpy@2.3.0

// Single-shape host parsers: fromGitHubUrl, fromGitlabUrl, fromBitbucketUrl,
// fromComposerUrl, fromHexUrl, fromPubUrl, fromDockerUrl, fromCocoapodsUrl,
// fromHackageUrl, fromCranUrl, fromCondaUrl, fromCpanUrl, fromHuggingfaceUrl,
// fromLuarocksUrl, fromSwiftUrl, fromVscodeMarketplaceUrl, fromOpenVsxUrl
```

**Registry existence checks:**

```javascript
import { purlExists, npmExists } from '@socketregistry/packageurl-js/exists'

// Check if package exists in its registry
await purlExists(purl)
// -> { exists: true, latestVersion: '4.17.21' }

// Type-specific checks (modular)
await npmExists('lodash')
await npmExists('core', '@babel') // scoped package
await npmExists('lodash', undefined, '4.17.21') // validate version

// Supported registries:
// npmExists, pypiExists, cargoExists, gemExists,
// mavenExists, nugetExists, golangExists, packagistExists,
// cocoapodsExists, pubExists, hexExists, cpanExists,
// cranExists, hackageExists, condaExists, dockerExists,
// vscodeExtensionExists
```

### VERS (Version Range Specifier)

First-class implementation of the [VERS companion spec](https://github.com/package-url/vers-spec):

```javascript
import { Vers } from '@socketregistry/packageurl-js'

const range = Vers.parse('vers:npm/>=1.0.0|<2.0.0')
range.contains('1.5.0') // -> true
range.contains('2.0.0') // -> false
```

### Immutable updates

`PackageURL` instances are immutable; `with*` methods return a new instance:

```javascript
const next = purl
  .withVersion('5.0.0')
  .withQualifier('repository_url', 'https://github.com/lodash/lodash')
```

### Result-based parsing

Parse untrusted input without try/catch:

```javascript
import { PackageURL } from '@socketregistry/packageurl-js'

const result = PackageURL.tryFromString(userInput)
if (result.isOk()) {
  use(result.value)
} else {
  log(result.error)
}

PackageURL.isValid(userInput) // -> boolean
PackageURL.fromUrl('https://github.com/lodash/lodash') // infers purl from URL

// fromUrl also recognizes distribution (download) URLs and bare paths:
// wheels, sdists, tarballs, gems, and module-proxy archives.
PackageURL.fromUrl(
  '/packages/orjson-3.11.9-cp314-cp314-manylinux_2_17_x86_64.whl',
) // -> pkg:pypi/orjson@3.11.9
```

### TypeScript Types

All types are exported for maximum flexibility:

```typescript
import type {
  PackageURLObject,
  NpmPackageComponents,
  ParsedPurlComponents,
  QualifiersObject,
  ComponentEncoder,
  DownloadUrl,
  RepositoryUrl,
} from '@socketregistry/packageurl-js'

// Type-safe npm package parsing
const components: NpmPackageComponents = parseNpmSpecifier('lodash@4.17.21')

// Type-safe PURL objects
const obj: PackageURLObject = purl.toObject()
```

**Constants:**

```typescript
import { PurlQualifierNames, PURL_Type } from '@socketregistry/packageurl-js'

// Standard qualifier keys
PurlQualifierNames.Checksum // 'checksum'
PurlQualifierNames.RepositoryUrl // 'repository_url'

// Package types
PURL_Type.NPM // 'npm'
PURL_Type.PYPI // 'pypi'
```

See [docs/types.md](docs/types.md) for complete type reference.

## API Reference

- **[docs/api.md](docs/api.md)** - Complete API documentation
- **[docs/types.md](docs/types.md)** - TypeScript type reference

## Development

<details>
<summary>Contributor commands</summary>

```sh
pnpm install   # Install dependencies
pnpm build     # Build
pnpm test      # Test
pnpm check     # Lint + typecheck
```

</details>

## License

MIT
