# @socketregistry/packageurl-js

[![Socket Badge](https://socket.dev/api/badge/npm/package/@socketregistry/packageurl-js)](https://socket.dev/npm/package/@socketregistry/packageurl-js)
[![CI - @socketregistry/packageurl-js](https://github.com/SocketDev/socket-packageurl-js/actions/workflows/ci.yml/badge.svg)](https://github.com/SocketDev/socket-packageurl-js/actions/workflows/ci.yml)

[![Follow @SocketSecurity](https://img.shields.io/twitter/follow/SocketSecurity?style=social)](https://twitter.com/SocketSecurity)
[![Follow @socket.dev on Bluesky](https://img.shields.io/badge/Follow-@socket.dev-1DA1F2?style=social&logo=bluesky)](https://bsky.app/profile/socket.dev)

TypeScript-first Package URL (purl) parser and builder. **Drop-in replacement** for [`packageurl-js`](https://socket.dev/npm/package/packageurl-js) with better types and zero dependencies.

**Why use this?**
- 🎯 **TypeScript-first**: Full type safety and IntelliSense
- 📦 **Zero dependencies**: No supply chain bloat
- ✅ **Spec compliant**: Implements [Package URL specification](https://github.com/package-url/purl-spec)
- 🔨 **Builder API**: Fluent, ecosystem-specific builders

## Installation

```sh
pnpm install @socketregistry/packageurl-js
```

**Package override** (recommended for drop-in replacement):
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

**Parse existing purls:**
```javascript
import { PackageURL } from '@socketregistry/packageurl-js'

const purl = PackageURL.fromString('pkg:npm/lodash@4.17.21')
console.log(purl.name)      // 'lodash'
console.log(purl.version)   // '4.17.21'
```

**Build new purls (recommended):**
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

## Development

```bash
pnpm install   # Install dependencies
pnpm build     # Build
pnpm test      # Test
pnpm check     # Lint + typecheck
```
