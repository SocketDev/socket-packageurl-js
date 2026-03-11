# API Reference

Complete API documentation for `@socketregistry/packageurl-js`.

## Table of Contents

- [Modular Functions](#modular-functions)
- [PackageURL Class](#packageurl-class)
- [PurlBuilder Class](#purlbuilder-class)
- [UrlConverter Class](#urlconverter-class)
- [Registry Existence Checks](#registry-existence-checks)
- [Type Constants](#type-constants)

---

## Modular Functions

Tree-shakeable functions for optimal bundle size.

### `parseNpmSpecifier(specifier)`

Parse npm package specifier into components.

**Parameters:**

- `specifier: unknown` - npm package specifier string

**Returns:** `NpmPackageComponents`

```typescript
{
  namespace: string | undefined // e.g., '@babel' for scoped packages
  name: string // package name
  version: string | undefined // version without range prefixes
}
```

**Example:**

```javascript
import { parseNpmSpecifier } from '@socketregistry/packageurl-js'

parseNpmSpecifier('lodash@4.17.21')
// -> { namespace: undefined, name: 'lodash', version: '4.17.21' }

parseNpmSpecifier('@babel/core@^7.0.0')
// -> { namespace: '@babel', name: 'core', version: '7.0.0' }
```

**Features:**

- Strips version range prefixes (`^`, `~`, `>=`, etc.)
- Handles dist-tags (`latest`, `next`, `beta`)
- Supports scoped packages

---

### `stringify(purl)`

Convert PackageURL instance to canonical PURL string.

**Parameters:**

- `purl: PackageURL` - PackageURL instance

**Returns:** `string` - Canonical PURL string

**Example:**

```javascript
import { stringify } from '@socketregistry/packageurl-js'

const purl = new PackageURL('npm', undefined, 'lodash', '4.17.21')
stringify(purl)
// -> 'pkg:npm/lodash@4.17.21'
```

---

### `equals(a, b)`

Compare two PackageURLs for equality.

**Parameters:**

- `a: PackageURL` - First PURL
- `b: PackageURL` - Second PURL

**Returns:** `boolean` - true if equal

**Example:**

```javascript
import { equals } from '@socketregistry/packageurl-js'

const purl1 = PackageURL.fromString('pkg:npm/lodash@4.17.21')
const purl2 = PackageURL.fromString('pkg:npm/lodash@4.17.21')
equals(purl1, purl2) // -> true
```

---

### `compare(a, b)`

Compare two PackageURLs for sorting.

**Parameters:**

- `a: PackageURL` - First PURL
- `b: PackageURL` - Second PURL

**Returns:** `-1 | 0 | 1` - Sort order indicator

**Example:**

```javascript
import { compare } from '@socketregistry/packageurl-js'

const purls = [purl3, purl1, purl2]
purls.sort(compare) // Sort alphabetically
```

---

## PackageURL Class

Main class for parsing and constructing Package URLs.

### Constructor

```javascript
new PackageURL(type, namespace, name, version, qualifiers, subpath)
```

**Parameters:**

- `type: unknown` - Package ecosystem type (e.g., 'npm', 'pypi')
- `namespace: unknown` - Optional namespace/scope
- `name: unknown` - Package name (required)
- `version: unknown` - Optional version
- `qualifiers: unknown` - Optional key-value pairs
- `subpath: unknown` - Optional subpath

**Example:**

```javascript
new PackageURL('npm', '@babel', 'core', '7.20.0', null, null)
// -> 'pkg:npm/%40babel/core@7.20.0'
```

### Static Methods

#### `PackageURL.fromString(purlStr)`

Parse PURL string into PackageURL instance.

**Parameters:**

- `purlStr: unknown` - PURL string

**Returns:** `PackageURL`

**Example:**

```javascript
PackageURL.fromString('pkg:npm/lodash@4.17.21')
```

---

#### `PackageURL.fromNpm(specifier)`

Create PackageURL from npm package specifier.

**Parameters:**

- `specifier: unknown` - npm package specifier

**Returns:** `PackageURL`

**Example:**

```javascript
PackageURL.fromNpm('lodash@4.17.21')
PackageURL.fromNpm('@types/node@^18.0.0')
```

---

#### `PackageURL.fromSpec(type, specifier)`

Create PackageURL from ecosystem-specific specifier.

**Parameters:**

- `type: string` - Package type ('npm', etc.)
- `specifier: unknown` - Ecosystem-specific specifier

**Returns:** `PackageURL`

**Example:**

```javascript
PackageURL.fromSpec('npm', 'lodash@4.17.21')
```

**Currently supported:** npm only

---

#### `PackageURL.fromJSON(json)`

Parse PackageURL from JSON string.

**Parameters:**

- `json: unknown` - JSON string

**Returns:** `PackageURL`

**Example:**

```javascript
const json = '{"type":"npm","name":"lodash","version":"4.17.21"}'
PackageURL.fromJSON(json)
```

---

#### `PackageURL.parseString(purlStr)`

Parse PURL string into component array.

**Parameters:**

- `purlStr: unknown` - PURL string

**Returns:** `ParsedPurlComponents` - Tuple of components

**Example:**

```javascript
const [type, namespace, name, version, qualifiers, subpath] =
  PackageURL.parseString('pkg:npm/lodash@4.17.21')
```

### Instance Methods

#### `toString()`

Convert to canonical PURL string.

**Returns:** `string`

---

#### `toJSON()`

Convert to JSON-serializable object.

**Returns:** `string` - JSON string

---

#### `toObject()`

Convert to plain object.

**Returns:** `PackageURLObject`

---

#### `equals(other)`

Compare with another PackageURL.

**Parameters:**

- `other: PackageURL`

**Returns:** `boolean`

---

#### `compare(other)`

Compare for sorting.

**Parameters:**

- `other: PackageURL`

**Returns:** `-1 | 0 | 1`

### Properties

All properties are `string | undefined`:

- `type` - Package ecosystem type
- `namespace` - Optional namespace/scope
- `name` - Package name
- `version` - Optional version
- `qualifiers` - Optional key-value pairs
- `subpath` - Optional subpath

---

## PurlBuilder Class

Fluent builder API for constructing PURLs.

### Constructor

```javascript
new PurlBuilder()
```

### Static Factory Methods

#### `PurlBuilder.create()`

Create a new empty builder instance.

**Returns:** `PurlBuilder`

**Example:**

```javascript
const builder = PurlBuilder.create().type('npm').name('lodash').build()
```

---

#### `PurlBuilder.from(purl)`

Create a builder from an existing PackageURL instance.

**Parameters:**

- `purl: PackageURL` - Existing PackageURL to copy properties from

**Returns:** `PurlBuilder` - Builder with all properties pre-populated

**Example:**

```javascript
const originalPurl = PackageURL.fromString('pkg:npm/lodash@4.17.21')

const modifiedPurl = PurlBuilder.from(originalPurl)
  .version('4.18.0')
  .qualifier('arch', 'x64')
  .build()

console.log(modifiedPurl.toString())
// -> 'pkg:npm/lodash@4.18.0?arch=x64'
```

**Use cases:**

- Modify existing PURLs while preserving most properties
- Create variants of a PURL with different versions or qualifiers
- Clone and customize PURLs

---

#### Type-Specific Factory Methods

Create builders with type preset:

```javascript
PurlBuilder.npm()
PurlBuilder.pypi()
PurlBuilder.maven()
PurlBuilder.gem()
PurlBuilder.cargo()
PurlBuilder.composer()
PurlBuilder.golang()
PurlBuilder.nuget()
// ... and 30+ more ecosystems
```

**Example:**

```javascript
const purl = PurlBuilder.npm().name('lodash').version('4.17.21').build()
```

### Builder Methods

All methods return `this` for chaining:

#### `type(value)`

Set package type.

---

#### `namespace(value)`

Set namespace/scope.

---

#### `name(value)`

Set package name (required).

---

#### `version(value)`

Set version.

---

#### `qualifier(key, value)`

Add a qualifier key-value pair.

---

#### `qualifiers(object)`

Set all qualifiers at once.

---

#### `subpath(value)`

Set subpath.

---

#### `build()`

Build and return PackageURL instance.

**Returns:** `PackageURL`

### Example

```javascript
import { PurlBuilder } from '@socketregistry/packageurl-js'

const purl = PurlBuilder.maven()
  .namespace('org.springframework')
  .name('spring-core')
  .version('5.3.21')
  .qualifier('classifier', 'sources')
  .build()

console.log(purl.toString())
// -> 'pkg:maven/org.springframework/spring-core@5.3.21?classifier=sources'
```

---

## UrlConverter Class

Convert PURLs to repository and download URLs.

### Static Methods

#### `UrlConverter.toRepositoryUrl(purl)`

Convert to repository URL.

**Parameters:**

- `purl: PackageURL`

**Returns:** `RepositoryUrl | null`

**Example:**

```javascript
import { UrlConverter } from '@socketregistry/packageurl-js'

const purl = PackageURL.fromString('pkg:npm/lodash@4.17.21')
UrlConverter.toRepositoryUrl(purl)
// -> { type: 'git', url: 'https://github.com/lodash/lodash' }
```

---

#### `UrlConverter.toDownloadUrl(purl)`

Convert to download URL.

**Parameters:**

- `purl: PackageURL`

**Returns:** `DownloadUrl | null`

**Example:**

```javascript
UrlConverter.toDownloadUrl(purl)
// -> { type: 'tarball', url: 'https://registry.npmjs.org/...' }
```

---

## Registry Existence Checks

Modular functions to verify package existence across 14 package registries. Each function queries the official registry API to check if a package exists and optionally validates a specific version.

### `purlExists(purl, options?)`

Generic wrapper that dispatches to type-specific existence checks based on the PackageURL type.

**Parameters:**

- `purl: PackageURL` - PackageURL instance to check
- `options?: ExistsOptions` - Optional configuration
  - `cache?: TtlCache` - Optional TTL cache for caching responses

**Returns:** `Promise<ExistsResult>`

```typescript
{
  exists: boolean            // Whether the package exists
  latestVersion?: string     // Latest version from registry
  error?: string            // Error message if check failed
}
```

**Example:**

```javascript
import { purlExists, PackageURL } from '@socketregistry/packageurl-js'

const purl = PackageURL.fromString('pkg:npm/lodash@4.17.21')
const result = await purlExists(purl)
// -> { exists: true, latestVersion: '4.17.21' }

// With caching
import { createTtlCache } from '@socketsecurity/lib/cache-with-ttl'
const cache = createTtlCache({ ttl: 5 * 60 * 1000 })
await purlExists(purl, { cache })
```

**Supported types:** npm, pypi, cargo, gem, maven, nuget, golang, composer, cocoapods, pub, hex, cpan, cran, hackage

---

### Type-Specific Functions

All registry functions follow the same signature pattern and return `ExistsResult`.

#### `npmExists(name, namespace?, version?, options?)`

Check npm packages from registry.npmjs.org.

**Example:**

```javascript
import { npmExists } from '@socketregistry/packageurl-js'

await npmExists('lodash')
// -> { exists: true, latestVersion: '4.17.21' }

await npmExists('core', '@babel') // scoped package
// -> { exists: true, latestVersion: '7.23.0' }

await npmExists('lodash', undefined, '4.17.21') // validate version
// -> { exists: true, latestVersion: '4.17.21' }
```

---

#### `pypiExists(name, version?, options?)`

Check Python packages from pypi.org.

**Example:**

```javascript
import { pypiExists } from '@socketregistry/packageurl-js'

await pypiExists('requests')
// -> { exists: true, latestVersion: '2.31.0' }
```

---

#### `cargoExists(name, version?, options?)`

Check Rust crates from crates.io.

**Example:**

```javascript
import { cargoExists } from '@socketregistry/packageurl-js'

await cargoExists('serde')
// -> { exists: true, latestVersion: '1.0.197' }
```

---

#### `gemExists(name, version?, options?)`

Check Ruby gems from rubygems.org.

**Example:**

```javascript
import { gemExists } from '@socketregistry/packageurl-js'

await gemExists('rails')
// -> { exists: true, latestVersion: '7.1.3' }
```

---

#### `mavenExists(name, namespace, version?, options?)`

Check Java packages from Maven Central. Requires namespace (group ID).

**Example:**

```javascript
import { mavenExists } from '@socketregistry/packageurl-js'

await mavenExists('commons-lang3', 'org.apache.commons')
// -> { exists: true, latestVersion: '3.12.0' }
```

---

#### `nugetExists(name, version?, options?)`

Check .NET packages from nuget.org.

**Example:**

```javascript
import { nugetExists } from '@socketregistry/packageurl-js'

await nugetExists('Newtonsoft.Json')
// -> { exists: true, latestVersion: '13.0.3' }
```

---

#### `golangExists(name, namespace?, version?, options?)`

Check Go modules from proxy.golang.org.

**Example:**

```javascript
import { golangExists } from '@socketregistry/packageurl-js'

await golangExists('github.com/gorilla/mux')
// -> { exists: true, latestVersion: 'v1.8.0' }

await golangExists('mux', 'github.com/gorilla') // with namespace
// -> { exists: true, latestVersion: 'v1.8.0' }
```

---

#### `packagistExists(name, namespace, version?, options?)`

Check PHP/Composer packages from packagist.org. Requires namespace (vendor).

**Example:**

```javascript
import { packagistExists } from '@socketregistry/packageurl-js'

await packagistExists('http-foundation', 'symfony')
// -> { exists: true, latestVersion: 'v6.3.0' }
```

---

#### `cocoapodsExists(name, version?, options?)`

Check iOS/macOS pods from trunk.cocoapods.org.

**Example:**

```javascript
import { cocoapodsExists } from '@socketregistry/packageurl-js'

await cocoapodsExists('Alamofire')
// -> { exists: true, latestVersion: '5.8.1' }
```

---

#### `pubExists(name, version?, options?)`

Check Dart/Flutter packages from pub.dev.

**Example:**

```javascript
import { pubExists } from '@socketregistry/packageurl-js'

await pubExists('flutter_bloc')
// -> { exists: true, latestVersion: '8.1.3' }
```

---

#### `hexExists(name, version?, options?)`

Check Elixir/Erlang packages from hex.pm.

**Example:**

```javascript
import { hexExists } from '@socketregistry/packageurl-js'

await hexExists('phoenix')
// -> { exists: true, latestVersion: '1.7.10' }
```

---

#### `cpanExists(name, version?, options?)`

Check Perl modules from metacpan.org.

**Example:**

```javascript
import { cpanExists } from '@socketregistry/packageurl-js'

await cpanExists('Moose')
// -> { exists: true, latestVersion: '2.2206' }
```

---

#### `cranExists(name, version?, options?)`

Check R packages from cran.r-universe.dev.

**Example:**

```javascript
import { cranExists } from '@socketregistry/packageurl-js'

await cranExists('ggplot2')
// -> { exists: true, latestVersion: '3.4.4' }
```

---

#### `hackageExists(name, version?, options?)`

Check Haskell packages from hackage.haskell.org.

**Example:**

```javascript
import { hackageExists } from '@socketregistry/packageurl-js'

await hackageExists('aeson')
// -> { exists: true, latestVersion: '2.2.0.0' }
```

---

## Type Constants

### `PURL_Type`

Enum-like object with all supported PURL types:

```javascript
import { PURL_Type } from '@socketregistry/packageurl-js'

PURL_Type.NPM // 'npm'
PURL_Type.PYPI // 'pypi'
PURL_Type.MAVEN // 'maven'
PURL_Type.CARGO // 'cargo'
// ... 35+ types
```

---

### `PurlQualifierNames`

Constants for standard PURL qualifier keys as defined in the [purl-spec](https://github.com/package-url/purl-spec/blob/master/PURL-SPECIFICATION.rst#known-qualifiers-keyvalue-pairs).

```javascript
import { PurlQualifierNames } from '@socketregistry/packageurl-js'

PurlQualifierNames.RepositoryUrl // 'repository_url'
PurlQualifierNames.DownloadUrl // 'download_url'
PurlQualifierNames.VcsUrl // 'vcs_url'
PurlQualifierNames.FileName // 'file_name'
PurlQualifierNames.Checksum // 'checksum'
```

**Usage:**

```javascript
const purl = PurlBuilder.maven()
  .namespace('org.apache.commons')
  .name('commons-lang3')
  .version('3.12.0')
  .qualifier(PurlQualifierNames.Checksum, 'sha256:abc123')
  .qualifier(PurlQualifierNames.DownloadUrl, 'https://repo1.maven.org/...')
  .build()
```

**Known qualifiers:**

- `repository_url` - URL to package repository homepage
- `download_url` - Direct download URL for the package artifact
- `vcs_url` - Version control system URL (git, svn, etc.)
- `file_name` - Name of the package file or artifact
- `checksum` - Checksum value in the format `algorithm:value` (e.g., `sha256:abc123`)

---

### `PurlType`

Object with type-specific normalization and validation:

```javascript
import { PurlType } from '@socketregistry/packageurl-js'

PurlType.npm.normalize(purl)
PurlType.npm.validate(purl)
```

**Type-specific rules:**

**npm:**

- Name: Lowercased, namespace preserved with `@` prefix
- Version: Requires valid semver format
- Namespace: Used for scoped packages (e.g., `@types`)

**pypi:**

- Name: Lowercased, underscores replaced with dashes
- Namespace: Must be empty
- Version: Normalized according to PEP 440

**maven:**

- Name: Preserved as-is
- Namespace: Required (groupId)
- Case-sensitive

**cargo:**

- Name: Lowercased
- Namespace: Must be empty
- Version: Follows semver

---

### `PurlComponent`

Component encoding/decoding utilities:

```javascript
import { PurlComponent } from '@socketregistry/packageurl-js'

PurlComponent.name.encode('my-package')
PurlComponent.name.decode('my-package')
```

**Available components:**

- `type` - Package ecosystem type
- `namespace` - Optional namespace/scope
- `name` - Package name (required)
- `version` - Package version
- `qualifiers` - Key-value pairs
- `subpath` - Path within package

**Encoding rules:**

- UTF-8 characters are percent-encoded
- Forward slashes in namespaces become encoded
- `@` in npm scopes is encoded as `%40`
- Special characters in names/versions are encoded per spec

---

## Error Handling

### `PurlError`

Custom error class for PURL-specific errors.

```javascript
import { PurlError } from '@socketregistry/packageurl-js'

try {
  PackageURL.fromString('invalid')
} catch (error) {
  if (error instanceof PurlError) {
    console.error('PURL error:', error.message)
  }
}
```

### Validation Rules

The library performs strict validation on all components:

**Type validation:**

- Required for all PURLs
- Must be lowercase letters, numbers, `.`, `+`, or `-`
- Cannot be empty
- Example errors:
  - `'type' is a required component`
  - `'type' component must be lowercase`

**Name validation:**

- Required for all PURLs
- Cannot contain whitespace (some types)
- Cannot be empty
- Type-specific rules apply (e.g., npm name validation)
- Example errors:
  - `'name' is a required component`
  - `npm 'name' component cannot contain whitespace`

**Namespace validation:**

- Optional for most types, required for some (e.g., maven)
- Type-specific rules apply
- Cannot contain whitespace (some types)
- Example errors:
  - `maven requires a 'namespace' component`
  - `npm 'namespace' component cannot contain whitespace`

**Version validation:**

- Optional for most types
- Type-specific format requirements (e.g., semver for npm)
- Example errors:
  - `npm 'version' component must be valid semver`
  - `'version' component cannot be empty`

**Qualifiers validation:**

- Keys must be lowercase alphanumeric with `.`, `-`, or `_`
- Values must not be empty strings
- Example errors:
  - `qualifier 'Arch' must be lowercase`
  - `qualifier 'os' must not be empty`

**Subpath validation:**

- Must not start with `/`
- Cannot contain `..` segments
- Example errors:
  - `'subpath' component cannot start with '/'`
  - `'subpath' component cannot contain '..' segments`

### Common Error Scenarios

**Invalid PURL string:**

```javascript
// Missing 'pkg:' scheme
PackageURL.fromString('npm/lodash')
// -> PurlError: missing required "pkg" scheme component

// Missing type
PackageURL.fromString('pkg:/lodash')
// -> PurlError: 'type' is a required component

// Missing name
PackageURL.fromString('pkg:npm/')
// -> PurlError: 'name' is a required component
```

**Type-specific violations:**

```javascript
// npm requires valid semver
new PackageURL('npm', undefined, 'lodash', 'latest')
// -> PurlError: npm 'version' component must be valid semver

// maven requires namespace
new PackageURL('maven', undefined, 'commons-lang3', '3.12.0')
// -> PurlError: maven requires a 'namespace' component
```

**Invalid qualifiers:**

```javascript
const purl = PurlBuilder.npm()
  .name('lodash')
  .qualifier('Arch', 'x64') // Uppercase not allowed
  .build()
// -> PurlError: qualifier 'Arch' must be lowercase
```

---

## Result Type

Functional error handling with `Result<T, E>` type:

```javascript
import { ok, err, ResultUtils } from '@socketregistry/packageurl-js'

const result = ok('success')
result.isOk() // -> true
result.unwrap() // -> 'success'

const failure = err(new Error('failed'))
failure.isErr() // -> true
failure.unwrap() // throws Error
```

See [types.md](types.md) for complete type definitions.
