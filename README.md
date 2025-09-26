# @socketregistry/packageurl-js

[![Socket Badge](https://socket.dev/api/badge/npm/package/@socketregistry/packageurl-js)](https://socket.dev/npm/package/@socketregistry/packageurl-js)
[![CI - @socketregistry/packageurl-js](https://github.com/SocketDev/socket-packageurl-js/actions/workflows/test.yml/badge.svg)](https://github.com/SocketDev/socket-packageurl-js/actions/workflows/test.yml)
[![Follow @SocketSecurity](https://img.shields.io/twitter/follow/SocketSecurity?style=social)](https://twitter.com/SocketSecurity)
[![Follow @socket.dev on Bluesky](https://img.shields.io/badge/Follow-@socket.dev-1DA1F2?style=social&logo=bluesky)](https://bsky.app/profile/socket.dev)

TypeScript-first Package URL parser. Drop-in replacement for [`packageurl-js`](https://socket.dev/npm/package/packageurl-js).

- TypeScript support
- Zero dependencies
- [Package URL spec](https://github.com/package-url/purl-spec) compliant
- Builder pattern API

## Installation

```sh
pnpm install @socketregistry/packageurl-js
```

**Package override** (recommended):
```json
{
  "overrides": {
    "packageurl-js": "npm:@socketregistry/packageurl-js@^1"
  }
}
```

**Requirements**: Node >= 18.20.4

## Usage

```javascript
import { PackageURL, PackageURLBuilder, UrlConverter } from '@socketregistry/packageurl-js'

// Parse from string
const purl = PackageURL.fromString('pkg:npm/lodash@4.17.21')
console.log(purl.name)      // 'lodash'

// Create from components
const newPurl = new PackageURL('npm', null, 'express', '4.18.2')
// -> 'pkg:npm/express@4.18.2'

// Builder pattern - ecosystem-specific builders
const npmPurl = PackageURLBuilder
  .npm()
  .name('lodash')
  .version('4.17.21')
  .build()
// -> 'pkg:npm/lodash@4.17.21'

const pythonPurl = PackageURLBuilder
  .pypi()
  .name('requests')
  .version('2.28.1')
  .build()
// -> 'pkg:pypi/requests@2.28.1'

const javaPurl = PackageURLBuilder
  .maven()
  .namespace('org.springframework')
  .name('spring-core')
  .version('5.3.21')
  .qualifier('classifier', 'sources')
  .build()
// -> 'pkg:maven/org.springframework/spring-core@5.3.21?classifier=sources'

// Subpaths for packages like npm/@babel/runtime
const subpathPurl = new PackageURL('npm', '@babel', 'runtime', '7.18.6', null, 'helpers/typeof.js')
// -> 'pkg:npm/%40babel/runtime@7.18.6#helpers/typeof.js'

// URL conversion
const repoUrl = UrlConverter.toRepositoryUrl(purl)
// -> 'https://github.com/lodash/lodash'
const downloadUrl = UrlConverter.toDownloadUrl(purl)
// -> 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz'
```

## Development

```bash
pnpm install   # Install dependencies
pnpm build     # Build
pnpm test      # Test
pnpm check     # Lint + typecheck
```
