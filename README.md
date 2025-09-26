# @socketregistry/packageurl-js

[![Socket Badge](https://socket.dev/api/badge/npm/package/@socketregistry/packageurl-js)](https://socket.dev/npm/package/@socketregistry/packageurl-js)
[![CI - @socketregistry/packageurl-js](https://github.com/SocketDev/socket-packageurl-js/actions/workflows/test.yml/badge.svg)](https://github.com/SocketDev/socket-packageurl-js/actions/workflows/test.yml)
[![Follow @SocketSecurity](https://img.shields.io/twitter/follow/SocketSecurity?style=social)](https://twitter.com/SocketSecurity)

> An enhanced and tested zero dependency drop-in replacement of
> [`packageurl-js`](https://socket.dev/npm/package/packageurl-js) complete with
> TypeScript types.

## Installation

### Install as a package override

[`socket`](https://socket.dev/npm/package/socket) CLI will automagically ✨
populate
[overrides](https://docs.npmjs.com/cli/v9/configuring-npm/package-json#overrides)
and [resolutions](https://yarnpkg.com/configuration/manifest#resolutions) of
your `package.json`.

```sh
npx socket optimize
```

Prefer to do it yourself? Add `@socketregistry/packageurl-js` to your
`package.json`.

```json
{
  "overrides": {
    "packageurl-js": "npm:@socketregistry/packageurl-js@^1"
  },
  "resolutions": {
    "packageurl-js": "npm:@socketregistry/packageurl-js@^1"
  }
}
```

### Install as a plain dependency

Install with your favorite package manager.

```sh
npm install @socketregistry/packageurl-js
```

## Requirements

Node >= `18.20.4`

## Usage

### Basic PackageURL Operations

```javascript
import { PackageURL } from '@socketregistry/packageurl-js'

// Parse a Package URL string
const purl = PackageURL.fromString('pkg:npm/lodash@4.17.21')
console.log(purl.type)      // 'npm'
console.log(purl.name)      // 'lodash'
console.log(purl.version)   // '4.17.21'

// Create a PackageURL from components
const newPurl = new PackageURL('npm', null, 'express', '4.18.2')
console.log(newPurl.toString()) // 'pkg:npm/express@4.18.2'

// With namespace (scope for npm)
const scopedPurl = new PackageURL('npm', '@angular', 'core', '15.0.0')
console.log(scopedPurl.toString()) // 'pkg:npm/%40angular/core@15.0.0'
```

### Using the Builder Pattern

The `PackageURLBuilder` provides a fluent API for constructing Package URLs:

```javascript
import { PackageURLBuilder } from '@socketregistry/packageurl-js'

// Build an npm package URL
const npmPurl = PackageURLBuilder
  .npm()
  .name('lodash')
  .version('4.17.21')
  .build()

console.log(npmPurl.toString()) // 'pkg:npm/lodash@4.17.21'

// Build a Maven package URL with qualifiers
const mavenPurl = PackageURLBuilder
  .maven()
  .namespace('org.apache.commons')
  .name('commons-lang3')
  .version('3.12.0')
  .qualifier('classifier', 'sources')
  .build()

// Build from scratch with all components
const complexPurl = PackageURLBuilder
  .create()
  .type('cargo')
  .name('serde')
  .version('1.0.152')
  .qualifier('arch', 'x86_64')
  .qualifier('os', 'linux')
  .build()

// Copy and modify an existing PackageURL
const modifiedPurl = PackageURLBuilder
  .from(npmPurl)
  .version('4.17.20')
  .build()
```

### Available Builder Presets

The builder includes convenience methods for popular package types:

```javascript
// Language/ecosystem-specific builders
PackageURLBuilder.cargo()     // Rust crates
PackageURLBuilder.composer()  // PHP packages
PackageURLBuilder.gem()       // Ruby gems
PackageURLBuilder.golang()    // Go packages
PackageURLBuilder.maven()     // Maven/Java packages
PackageURLBuilder.npm()       // npm packages
PackageURLBuilder.nuget()     // .NET packages
PackageURLBuilder.pypi()      // Python packages
```

### URL Conversion

The `UrlConverter` class can generate repository and download URLs from Package URLs:

```javascript
import { UrlConverter } from '@socketregistry/packageurl-js'

const purl = PackageURLBuilder
  .npm()
  .name('lodash')
  .version('4.17.21')
  .build()

// Get repository URL (where source code lives)
const repoUrl = UrlConverter.toRepositoryUrl(purl)
console.log(repoUrl)
// { url: 'https://npmjs.com/package/lodash', type: 'web' }

// Get download URL (where to download the package)
const downloadUrl = UrlConverter.toDownloadUrl(purl)
console.log(downloadUrl)
// { url: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz', type: 'tarball' }

// Get both URLs at once
const allUrls = UrlConverter.getAllUrls(purl)
console.log(allUrls)
// {
//   repository: { url: 'https://npmjs.com/package/lodash', type: 'web' },
//   download: { url: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz', type: 'tarball' }
// }

// Check if a package type supports URL conversion
console.log(UrlConverter.supportsRepositoryUrl('npm'))  // true
console.log(UrlConverter.supportsDownloadUrl('npm'))    // true
```

### Working with Different Package Types

Examples for various package ecosystems:

```javascript
// Rust crate with qualifiers
const rustPurl = PackageURLBuilder
  .cargo()
  .name('serde')
  .version('1.0.152')
  .qualifier('feature', 'derive')
  .build()

// Ruby gem
const rubyPurl = PackageURLBuilder
  .gem()
  .name('rails')
  .version('7.0.3')
  .build()

// Go package with namespace (module path)
const goPurl = PackageURLBuilder
  .golang()
  .namespace('github.com/gin-gonic')
  .name('gin')
  .version('v1.8.1')
  .build()

// Maven package with namespace (groupId)
const mavenPurl = PackageURLBuilder
  .maven()
  .namespace('org.springframework')
  .name('spring-core')
  .version('5.3.21')
  .build()

// Python package
const pythonPurl = PackageURLBuilder
  .pypi()
  .name('requests')
  .version('2.28.1')
  .build()
```

### Advanced Features

```javascript
// Package URLs with subpaths
const purlWithSubpath = new PackageURL(
  'npm',
  '@babel',
  'runtime',
  '7.18.6',
  null,
  'helpers/typeof.js'
)

// Package URLs with qualifiers
const purlWithQualifiers = new PackageURL(
  'maven',
  'org.apache.commons',
  'commons-lang3',
  '3.12.0',
  { classifier: 'sources', type: 'jar' }
)

// Validation and normalization
try {
  const purl = PackageURL.fromString('invalid-purl')
} catch (error) {
  console.log('Invalid Package URL format')
}

// Working with qualifiers
const purl = PackageURLBuilder
  .create()
  .type('custom')
  .name('mypackage')
  .qualifiers({ arch: 'amd64', os: 'linux' })
  .qualifier('extra', 'value')  // Add individual qualifier
  .build()
```
