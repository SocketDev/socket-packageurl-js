# API Reference

API reference for `@socketregistry/packageurl-js`. All parsing and validation methods throw on invalid input.

## PackageURL

Main class for parsing, constructing, and manipulating Package URLs.

### Constructor

#### `new PackageURL(type, namespace, name, version, qualifiers, subpath)`

Create a new PackageURL instance with validation and normalization.

**Parameters:**
- `type` - Package type (e.g., 'npm', 'pypi', 'maven')
- `namespace` - Package namespace/scope (optional)
- `name` - Package name (required)
- `version` - Package version (optional)
- `qualifiers` - Additional qualifiers object (optional)
- `subpath` - Subpath within package (optional)

**Throws:** On validation failure

<details>
<summary>Show example</summary>

```typescript
import { PackageURL } from '@socketregistry/packageurl-js'

// Simple package
const purl = new PackageURL('npm', null, 'lodash', '4.17.21', null, null)
console.log(purl.toString())  // 'pkg:npm/lodash@4.17.21'

// Scoped package
const scoped = new PackageURL('npm', '@babel', 'core', '7.20.0', null, null)
console.log(scoped.toString())  // 'pkg:npm/%40babel/core@7.20.0'

// With qualifiers
const qualified = new PackageURL(
  'maven',
  'org.apache',
  'commons-lang3',
  '3.12.0',
  { classifier: 'sources' },
  null
)
// 'pkg:maven/org.apache/commons-lang3@3.12.0?classifier=sources'

// With subpath
const subpathPurl = new PackageURL(
  'npm',
  null,
  'lodash',
  '4.17.21',
  null,
  'helpers/isArray.js'
)
// 'pkg:npm/lodash@4.17.21#helpers/isArray.js'
```

</details>

---

### Static Methods

#### `PackageURL.fromString(purlStr)`

Parse a purl string into a PackageURL instance.

**Parameters:**
- `purlStr` - Package URL string (e.g., 'pkg:npm/express@4.18.0')

**Returns:** PackageURL instance

**Throws:** On invalid string

<details>
<summary>Show example</summary>

```typescript
import { PackageURL } from '@socketregistry/packageurl-js'

const purl = PackageURL.fromString('pkg:npm/lodash@4.17.21')
console.log(purl.name)     // 'lodash'
console.log(purl.version)  // '4.17.21'

// Auto-prepends 'pkg:' if missing and looks like a purl
const auto = PackageURL.fromString('npm/express@4.18.0')
console.log(auto.toString())  // 'pkg:npm/express@4.18.0'

// Parses complex purls
const complex = PackageURL.fromString(
  'pkg:maven/org.apache/commons@3.12.0?classifier=sources#src/main'
)
console.log(complex.namespace)           // 'org.apache'
console.log(complex.qualifiers.classifier)  // 'sources'
console.log(complex.subpath)             // 'src/main'
```

</details>

---

#### `PackageURL.fromJSON(jsonStr)`

Create a PackageURL from a JSON string representation.

**Parameters:**
- `jsonStr` - JSON string containing purl components

**Returns:** PackageURL instance

**Throws:** On invalid JSON

<details>
<summary>Show example</summary>

```typescript
import { PackageURL } from '@socketregistry/packageurl-js'

const json = '{"type":"npm","name":"lodash","version":"4.17.21"}'
const purl = PackageURL.fromJSON(json)

console.log(purl.type)     // 'npm'
console.log(purl.name)     // 'lodash'
console.log(purl.version)  // '4.17.21'
```

</details>

---

#### `PackageURL.fromObject(obj)`

Create a PackageURL from a plain object.

**Parameters:**
- `obj` - Object with purl component properties

**Returns:** PackageURL instance

**Throws:** On invalid object structure

<details>
<summary>Show example</summary>

```typescript
import { PackageURL } from '@socketregistry/packageurl-js'

const purl = PackageURL.fromObject({
  type: 'npm',
  namespace: '@babel',
  name: 'core',
  version: '7.20.0'
})

console.log(purl.toString())  // 'pkg:npm/%40babel/core@7.20.0'
```

</details>

---

#### `PackageURL.parseString(purlStr)`

Parse a purl string into an array of components.

**Parameters:**
- `purlStr` - Package URL string

**Returns:** Array of [type, namespace, name, version, qualifiers, subpath]

**Throws:** On parse failure

<details>
<summary>Show example</summary>

```typescript
import { PackageURL } from '@socketregistry/packageurl-js'

const parts = PackageURL.parseString('pkg:npm/@babel/core@7.20.0')
const [type, namespace, name, version, qualifiers, subpath] = parts

console.log(type)       // 'npm'
console.log(namespace)  // '@babel'
console.log(name)       // 'core'
console.log(version)    // '7.20.0'
```

</details>

---

### Instance Methods

#### `toString()`

Convert PackageURL to its canonical purl string representation.

**Returns:** String in purl format

<details>
<summary>Show example</summary>

```typescript
import { PackageURL } from '@socketregistry/packageurl-js'

const purl = new PackageURL('npm', null, 'express', '4.18.0', null, null)
console.log(purl.toString())  // 'pkg:npm/express@4.18.0'

// Automatically called by string coercion
console.log(`Package: ${purl}`)  // 'Package: pkg:npm/express@4.18.0'
```

</details>

---

#### `toObject()`

Convert PackageURL to a plain object representation.

**Returns:** Object with purl component properties

<details>
<summary>Show example</summary>

```typescript
import { PackageURL } from '@socketregistry/packageurl-js'

const purl = PackageURL.fromString('pkg:npm/@babel/core@7.20.0')
const obj = purl.toObject()

console.log(obj)
// {
//   type: 'npm',
//   namespace: '@babel',
//   name: 'core',
//   version: '7.20.0'
// }
```

</details>

---

#### `toJSON()`

Convert PackageURL to JSON-serializable object (alias for toObject).

**Returns:** Object for JSON.stringify

<details>
<summary>Show example</summary>

```typescript
import { PackageURL } from '@socketregistry/packageurl-js'

const purl = PackageURL.fromString('pkg:npm/lodash@4.17.21')
console.log(JSON.stringify(purl))
// '{"type":"npm","name":"lodash","version":"4.17.21"}'
```

</details>

---

#### `toJSONString()`

Convert PackageURL directly to a JSON string.

**Returns:** JSON string representation

<details>
<summary>Show example</summary>

```typescript
import { PackageURL } from '@socketregistry/packageurl-js'

const purl = PackageURL.fromString('pkg:npm/express@4.18.0')
console.log(purl.toJSONString())
// '{"type":"npm","name":"express","version":"4.18.0"}'
```

</details>

---

### Static Properties

#### `PackageURL.Component`

Frozen object containing component-specific encoding, decoding, normalization, and validation functions.

<details>
<summary>Show example</summary>

```typescript
import { PackageURL } from '@socketregistry/packageurl-js'

// Access component helpers
const typeEncoder = PackageURL.Component.type.encode
const nameNormalizer = PackageURL.Component.name.normalize
const versionValidator = PackageURL.Component.version.validate
```

</details>

---

#### `PackageURL.KnownQualifierNames`

Frozen object listing well-known qualifier names for different package types.

<details>
<summary>Show example</summary>

```typescript
import { PackageURL } from '@socketregistry/packageurl-js'

console.log(PackageURL.KnownQualifierNames.maven)
// ['classifier', 'type', 'repository_url']

console.log(PackageURL.KnownQualifierNames.npm)
// ['repository_url', 'download_url', 'vcs_url']
```

</details>

---

#### `PackageURL.Type`

Frozen object containing type-specific normalization and validation logic.

<details>
<summary>Show example</summary>

```typescript
import { PackageURL } from '@socketregistry/packageurl-js'

// Check supported types
console.log(Object.keys(PackageURL.Type))
// ['npm', 'pypi', 'maven', 'gem', 'cargo', ...]
```

</details>

---

## PackageURLBuilder

Fluent builder API for constructing PackageURL instances.

### Constructor

#### `new PackageURLBuilder()`

Create a new builder instance.

<details>
<summary>Show example</summary>

```typescript
import { PackageURLBuilder } from '@socketregistry/packageurl-js'

const builder = new PackageURLBuilder()
const purl = builder
  .type('npm')
  .name('lodash')
  .version('4.17.21')
  .build()
```

</details>

---

### Static Factory Methods

#### `PackageURLBuilder.npm()`

Create builder pre-configured for npm packages.

**Returns:** Builder instance with type='npm'

<details>
<summary>Show example</summary>

```typescript
import { PackageURLBuilder } from '@socketregistry/packageurl-js'

const purl = PackageURLBuilder.npm()
  .name('express')
  .version('4.18.0')
  .build()
// 'pkg:npm/express@4.18.0'

// Scoped packages
const scoped = PackageURLBuilder.npm()
  .namespace('@babel')
  .name('core')
  .version('7.20.0')
  .build()
// 'pkg:npm/%40babel/core@7.20.0'
```

</details>

---

#### `PackageURLBuilder.pypi()`

Create builder pre-configured for Python packages.

<details>
<summary>Show example</summary>

```typescript
import { PackageURLBuilder } from '@socketregistry/packageurl-js'

const purl = PackageURLBuilder.pypi()
  .name('requests')
  .version('2.28.1')
  .build()
// 'pkg:pypi/requests@2.28.1'
```

</details>

---

#### `PackageURLBuilder.maven()`

Create builder pre-configured for Maven packages.

<details>
<summary>Show example</summary>

```typescript
import { PackageURLBuilder } from '@socketregistry/packageurl-js'

const purl = PackageURLBuilder.maven()
  .namespace('org.springframework')
  .name('spring-core')
  .version('5.3.21')
  .qualifier('classifier', 'sources')
  .build()
// 'pkg:maven/org.springframework/spring-core@5.3.21?classifier=sources'
```

</details>

---

#### Builder Methods for Other Ecosystems

Additional factory methods available:
- `PackageURLBuilder.gem()` - RubyGems
- `PackageURLBuilder.cargo()` - Rust crates
- `PackageURLBuilder.nuget()` - NuGet packages
- `PackageURLBuilder.composer()` - PHP packages
- `PackageURLBuilder.golang()` - Go modules
- `PackageURLBuilder.docker()` - Docker images
- `PackageURLBuilder.github()` - GitHub repos
- `PackageURLBuilder.deb()` - Debian packages
- `PackageURLBuilder.rpm()` - RPM packages

See [Builders Guide](./BUILDERS.md) for complete list.

---

### Builder Instance Methods

#### `type(type)`

Set the package type.

**Parameters:**
- `type` - Package ecosystem identifier

**Returns:** Builder instance (for chaining)

<details>
<summary>Show example</summary>

```typescript
const purl = new PackageURLBuilder()
  .type('npm')
  .name('lodash')
  .build()
```

</details>

---

#### `namespace(namespace)`

Set the package namespace/scope.

**Parameters:**
- `namespace` - Organization, group, or scope name

**Returns:** Builder instance (for chaining)

<details>
<summary>Show example</summary>

```typescript
// npm scope
PackageURLBuilder.npm()
  .namespace('@babel')
  .name('core')
  .build()

// Maven groupId
PackageURLBuilder.maven()
  .namespace('org.apache.commons')
  .name('commons-lang3')
  .build()
```

</details>

---

#### `name(name)`

Set the package name (required).

**Parameters:**
- `name` - Package name

**Returns:** Builder instance (for chaining)

<details>
<summary>Show example</summary>

```typescript
PackageURLBuilder.npm()
  .name('express')
  .version('4.18.0')
  .build()
```

</details>

---

#### `version(version)`

Set the package version.

**Parameters:**
- `version` - Version string

**Returns:** Builder instance (for chaining)

<details>
<summary>Show example</summary>

```typescript
PackageURLBuilder.npm()
  .name('lodash')
  .version('4.17.21')
  .build()
```

</details>

---

#### `qualifier(key, value)`

Add a single qualifier key-value pair.

**Parameters:**
- `key` - Qualifier name
- `value` - Qualifier value

**Returns:** Builder instance (for chaining)

<details>
<summary>Show example</summary>

```typescript
PackageURLBuilder.maven()
  .namespace('org.apache')
  .name('commons-lang3')
  .version('3.12.0')
  .qualifier('classifier', 'sources')
  .qualifier('type', 'jar')
  .build()
// 'pkg:maven/org.apache/commons-lang3@3.12.0?classifier=sources&type=jar'
```

</details>

---

#### `qualifiers(qualifiers)`

Set all qualifiers at once.

**Parameters:**
- `qualifiers` - Object with qualifier key-value pairs

**Returns:** Builder instance (for chaining)

<details>
<summary>Show example</summary>

```typescript
PackageURLBuilder.maven()
  .namespace('org.apache')
  .name('commons-lang3')
  .version('3.12.0')
  .qualifiers({ classifier: 'sources', type: 'jar' })
  .build()
```

</details>

---

#### `subpath(subpath)`

Set the subpath within the package.

**Parameters:**
- `subpath` - Path string (leading slashes automatically removed)

**Returns:** Builder instance (for chaining)

<details>
<summary>Show example</summary>

```typescript
PackageURLBuilder.npm()
  .name('lodash')
  .version('4.17.21')
  .subpath('helpers/isArray.js')
  .build()
// 'pkg:npm/lodash@4.17.21#helpers/isArray.js'
```

</details>

---

#### `build()`

Construct and return the final PackageURL instance.

**Returns:** PackageURL instance

**Throws:** On invalid configuration

<details>
<summary>Show example</summary>

```typescript
const purl = PackageURLBuilder.npm()
  .name('express')
  .version('4.18.0')
  .build()

console.log(purl.toString())  // 'pkg:npm/express@4.18.0'
```

</details>

---

## UrlConverter

Convert Package URLs to repository and download URLs.

### Static Methods

#### `UrlConverter.toRepositoryUrl(purl)`

Convert PackageURL to source code repository URL.

**Parameters:**
- `purl` - PackageURL instance

**Returns:** `RepositoryUrl | null`
- `type` - 'git' | 'hg' | 'svn' | 'web'
- `url` - Repository URL string

<details>
<summary>Show example</summary>

```typescript
import { PackageURL, UrlConverter } from '@socketregistry/packageurl-js'

const purl = PackageURL.fromString('pkg:npm/express@4.18.0')
const repo = UrlConverter.toRepositoryUrl(purl)

if (repo) {
  console.log(repo.type)  // 'git'
  console.log(repo.url)   // 'https://github.com/expressjs/express'
}
```

</details>

---

#### `UrlConverter.toDownloadUrl(purl)`

Convert PackageURL to package download URL.

**Parameters:**
- `purl` - PackageURL instance

**Returns:** `DownloadUrl | null`
- `type` - 'tarball' | 'zip' | 'jar' | 'wheel' | 'gem' | 'other'
- `url` - Download URL string

<details>
<summary>Show example</summary>

```typescript
import { PackageURL, UrlConverter } from '@socketregistry/packageurl-js'

const purl = PackageURL.fromString('pkg:npm/lodash@4.17.21')
const download = UrlConverter.toDownloadUrl(purl)

if (download) {
  console.log(download.type)  // 'tarball'
  console.log(download.url)   // 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz'
}
```

</details>

---

#### `UrlConverter.getAllUrls(purl)`

Get both repository and download URLs.

**Parameters:**
- `purl` - PackageURL instance

**Returns:** Object with `repository` and `download` properties

<details>
<summary>Show example</summary>

```typescript
import { PackageURL, UrlConverter } from '@socketregistry/packageurl-js'

const purl = PackageURL.fromString('pkg:npm/express@4.18.0')
const urls = UrlConverter.getAllUrls(purl)

console.log(urls.repository?.url)  // Repository URL
console.log(urls.download?.url)    // Download URL
```

</details>

---

#### `UrlConverter.supportsRepositoryUrl(type)`

Check if package type supports repository URL conversion.

**Parameters:**
- `type` - Package type string

**Returns:** Boolean

<details>
<summary>Show example</summary>

```typescript
import { UrlConverter } from '@socketregistry/packageurl-js'

console.log(UrlConverter.supportsRepositoryUrl('npm'))    // true
console.log(UrlConverter.supportsRepositoryUrl('pypi'))   // true
console.log(UrlConverter.supportsRepositoryUrl('unknown')) // false
```

</details>

---

#### `UrlConverter.supportsDownloadUrl(type)`

Check if package type supports download URL conversion.

**Parameters:**
- `type` - Package type string

**Returns:** Boolean

<details>
<summary>Show example</summary>

```typescript
import { UrlConverter } from '@socketregistry/packageurl-js'

console.log(UrlConverter.supportsDownloadUrl('npm'))   // true
console.log(UrlConverter.supportsDownloadUrl('maven')) // true
```

</details>

---

## Result Types

### `Ok<T>`

Success result wrapper.

**Properties:**
- `ok` - Boolean (always `true`)
- `value` - The success value of type `T`

<details>
<summary>Show example</summary>

```typescript
import { Ok, ok } from '@socketregistry/packageurl-js'

const result = ok('success')
if (result.ok) {
  console.log(result.value)  // 'success'
}
```

</details>

---

### `Err<E>`

Error result wrapper.

**Properties:**
- `ok` - Boolean (always `false`)
- `error` - The error value of type `E`

<details>
<summary>Show example</summary>

```typescript
import { Err, err } from '@socketregistry/packageurl-js'

const result = err('failed')
if (!result.ok) {
  console.log(result.error)  // 'failed'
}
```

</details>

---

### `ResultUtils`

Utility functions for working with Result types.

#### `ResultUtils.isOk(result)`

Type guard to check if result is Ok.

<details>
<summary>Show example</summary>

```typescript
import { ok, ResultUtils } from '@socketregistry/packageurl-js'

const result = ok(42)
if (ResultUtils.isOk(result)) {
  console.log(result.value)  // TypeScript knows this is Ok<number>
}
```

</details>

---

#### `ResultUtils.isErr(result)`

Type guard to check if result is Err.

<details>
<summary>Show example</summary>

```typescript
import { err, ResultUtils } from '@socketregistry/packageurl-js'

const result = err('error')
if (ResultUtils.isErr(result)) {
  console.log(result.error)  // TypeScript knows this is Err<string>
}
```

</details>

---

## See Also

- [Examples](./EXAMPLES.md) - Practical usage examples
- [Builder Guide](./BUILDERS.md) - Comprehensive builder patterns
- [Package URL Spec](https://github.com/package-url/purl-spec) - Official specification
