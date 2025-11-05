# @socketregistry/packageurl-js

[![Socket Badge](https://socket.dev/api/badge/npm/package/@socketregistry/packageurl-js)](https://socket.dev/npm/package/@socketregistry/packageurl-js)
[![CI - @socketregistry/packageurl-js](https://github.com/SocketDev/socket-packageurl-js/actions/workflows/ci.yml/badge.svg)](https://github.com/SocketDev/socket-packageurl-js/actions/workflows/ci.yml)
![Test Coverage](https://img.shields.io/badge/test--coverage-99.72%25-brightgreen)
![Type Coverage](https://img.shields.io/badge/type--coverage-99.71%25-brightgreen)

[![Follow @SocketSecurity](https://img.shields.io/twitter/follow/SocketSecurity?style=social)](https://twitter.com/SocketSecurity)
[![Follow @socket.dev on Bluesky](https://img.shields.io/badge/Follow-@socket.dev-1DA1F2?style=social&logo=bluesky)](https://bsky.app/profile/socket.dev)

TypeScript Package URL (purl) parser and builder. Drop-in replacement for [`packageurl-js`](https://socket.dev/npm/package/packageurl-js) with full type safety, zero dependencies, and spec compliance with the [Package URL specification](https://github.com/package-url/purl-spec).

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

**Supports 35+ ecosystems**: npm, pypi, maven, gem, cargo, nuget, composer, golang, docker, and more.

## Installation

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

**Requirements**: Node >= 18.20.4

## Usage

**Parse purls:**
```javascript
import { PackageURL } from '@socketregistry/packageurl-js'

const purl = PackageURL.fromString('pkg:npm/lodash@4.17.21')
console.log(purl.name)      // 'lodash'
console.log(purl.version)   // '4.17.21'
```

**Build purls:**
```javascript
import { PackageURLBuilder } from '@socketregistry/packageurl-js'

// npm packages
PackageURLBuilder.npm().name('lodash').version('4.17.21').build()
// -> 'pkg:npm/lodash@4.17.21'

// Python packages
PackageURLBuilder.pypi().name('requests').version('2.28.1').build()
// -> 'pkg:pypi/requests@2.28.1'

// Maven with namespace and qualifiers
PackageURLBuilder.maven()
  .namespace('org.springframework')
  .name('spring-core')
  .version('5.3.21')
  .qualifier('classifier', 'sources')
  .build()
// -> 'pkg:maven/org.springframework/spring-core@5.3.21?classifier=sources'
```

**Constructor API:**
```javascript
import { PackageURL } from '@socketregistry/packageurl-js'

new PackageURL('npm', null, 'express', '4.18.2')
// -> 'pkg:npm/express@4.18.2'

// With namespace and subpath
new PackageURL('npm', '@babel', 'runtime', '7.18.6', null, 'helpers/typeof.js')
// -> 'pkg:npm/%40babel/runtime@7.18.6#helpers/typeof.js'
```

**Convert to URLs:**
```javascript
import { UrlConverter } from '@socketregistry/packageurl-js'

UrlConverter.toRepositoryUrl(purl)
// -> 'https://github.com/lodash/lodash'

UrlConverter.toDownloadUrl(purl)
// -> 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz'
```

**Use type-safe PURL types:**
```javascript
import { PURL_Type, EcosystemString } from '@socketregistry/packageurl-js'

// Type-safe enum values
console.log(PURL_Type.NPM)      // 'npm'
console.log(PURL_Type.PYPI)     // 'pypi'
console.log(PURL_Type.MAVEN)    // 'maven'

// Use in type annotations
function processPurl(type: EcosystemString) {
  // type is constrained to valid PURL type strings
}
```

## Documentation

| Doc | Description |
|-----|-------------|
| **[Getting Started](./docs/getting-started.md)** | Quick start for contributors (5 min setup) |
| **[API Reference](./docs/api-reference.md)** | Complete API documentation |
| **[Examples](./docs/usage-examples.md)** | Common use cases and patterns |

## Development

**New to the project?** See the [**Getting Started Guide**](./docs/getting-started.md) for setup, workflow, and contribution guidelines.

**Quick commands:**
```bash
pnpm install   # Install dependencies
pnpm build     # Build
pnpm test      # Test
pnpm check     # Lint + typecheck
```
