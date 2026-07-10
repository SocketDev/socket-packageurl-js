# TypeScript Types Reference

Complete TypeScript type definitions for `@socketregistry/packageurl-js`.

All types are exported from the main entry point for maximum accessibility.

## Table of Contents

- [PURL Object Types](#purl-object-types)
- [Parser Types](#parser-types)
- [Component Types](#component-types)
- [URL Types](#url-types)
- [Result Types](#result-types)

---

## PURL Object Types

### `PackageURLObject`

Plain object representation of a Package URL.

```typescript
type PackageURLObject = {
  type?: string | undefined
  namespace?: string | undefined
  name?: string | undefined
  version?: string | undefined
  qualifiers?: QualifiersObject | undefined
  subpath?: string | undefined
}
```

**Usage:**

```typescript
import type { PackageURLObject } from '@socketregistry/packageurl-js'

const obj: PackageURLObject = {
  type: 'npm',
  name: 'lodash',
  version: '4.17.21',
}
```

**Returned by:**

- `PackageURL.toObject()`
- `JSON.parse(purl.toJSON())`

---

### `PackageURLComponentValue`

Union type for PURL component values.

```typescript
type PackageURLComponentValue = string | QualifiersObject | undefined
```

**Usage:**

Used for dynamic property access on PackageURL instances.

---

### `ParsedPurlComponents`

Labeled tuple of parsed PURL components.

```typescript
type ParsedPurlComponents = [
  type: string | undefined,
  namespace: string | undefined,
  name: string | undefined,
  version: string | undefined,
  qualifiers: URLSearchParams | undefined,
  subpath: string | undefined,
]
```

**Usage:**

```typescript
import type { ParsedPurlComponents } from '@socketregistry/packageurl-js'

const components: ParsedPurlComponents = PackageURL.parseString(
  'pkg:npm/lodash@4.17.21',
)

const [type, namespace, name, version, qualifiers, subpath] = components
```

**Returned by:**

- `PackageURL.parseString()`

---

## Parser Types

### `NpmPackageComponents`

Components parsed from npm package specifier.

```typescript
type NpmPackageComponents = {
  namespace: string | undefined // Scope for scoped packages (e.g., '@babel')
  name: string // Package name (required)
  version: string | undefined // Version without range prefixes
}
```

**Usage:**

```typescript
import { parseNpmSpecifier } from '@socketregistry/packageurl-js'
import type { NpmPackageComponents } from '@socketregistry/packageurl-js'

const components: NpmPackageComponents = parseNpmSpecifier('lodash@4.17.21')
// -> { namespace: undefined, name: 'lodash', version: '4.17.21' }
```

**Features:**

- `namespace` is populated for scoped packages (`@scope/package`)
- `version` has range prefixes stripped (`^`, `~`, `>=`, etc.)
- Dist-tags are preserved as-is (`latest`, `next`, `beta`)

**Returned by:**

- `parseNpmSpecifier()`

---

## Component Types

### `QualifiersObject`

Key-value pairs for PURL qualifiers.

```typescript
type QualifiersObject = Record<string, QualifiersValue>
```

**Usage:**

```typescript
import type { QualifiersObject } from '@socketregistry/packageurl-js'

const qualifiers: QualifiersObject = {
  arch: 'x86_64',
  os: 'linux',
  classifier: 'sources',
}
```

---

### `QualifiersValue`

Valid types for qualifier values.

```typescript
type QualifiersValue = string | number | boolean | null | undefined
```

**Usage:**

```typescript
const qualifiers: QualifiersObject = {
  debug: true, // boolean
  priority: 10, // number
  tag: 'stable', // string
  optional: null, // null
  missing: undefined, // undefined
}
```

---

### `ComponentEncoder`

Function type for encoding PURL components.

```typescript
type ComponentEncoder = (value: unknown) => string
```

**Usage:**

```typescript
import { PurlComponent } from '@socketregistry/packageurl-js'
import type { ComponentEncoder } from '@socketregistry/packageurl-js'

const encoder: ComponentEncoder = PurlComponent.name.encode
encoder('my-package') // -> 'my-package'
```

---

### `ComponentNormalizer`

Function type for normalizing PURL components.

```typescript
type ComponentNormalizer = (value: string) => string | undefined
```

**Usage:**

```typescript
import { PurlType } from '@socketregistry/packageurl-js'
import type { ComponentNormalizer } from '@socketregistry/packageurl-js'

const normalizer: ComponentNormalizer = PurlType.npm.normalizers.name
```

---

### `ComponentValidator`

Function type for validating PURL components.

```typescript
type ComponentValidator = (value: unknown, throws: boolean) => boolean
```

**Usage:**

```typescript
import type { ComponentValidator } from '@socketregistry/packageurl-js'

const validator: ComponentValidator = (value, throws) => {
  if (throws && !value) throw new Error('Invalid')
  return Boolean(value)
}
```

---

## URL Types

### `RepositoryUrl`

Repository URL conversion result.

```typescript
interface RepositoryUrl {
  type: 'git' | 'hg' | 'svn' | 'web'
  url: string
}
```

**Usage:**

```typescript
import { UrlConverter } from '@socketregistry/packageurl-js'
import type { RepositoryUrl } from '@socketregistry/packageurl-js'

const repo: RepositoryUrl | null = UrlConverter.toRepositoryUrl(purl)
if (repo) {
  console.log(`${repo.type}: ${repo.url}`)
}
```

**Returned by:**

- `UrlConverter.toRepositoryUrl()`

---

### `DownloadUrl`

Download URL conversion result.

```typescript
interface DownloadUrl {
  type: 'tarball' | 'zip' | 'exe' | 'wheel' | 'jar' | 'gem' | 'other'
  url: string
}
```

**Usage:**

```typescript
import { UrlConverter } from '@socketregistry/packageurl-js'
import type { DownloadUrl } from '@socketregistry/packageurl-js'

const download: DownloadUrl | null = UrlConverter.toDownloadUrl(purl)
if (download) {
  console.log(`Download ${download.type} from ${download.url}`)
}
```

**Returned by:**

- `UrlConverter.toDownloadUrl()`

---

## Result Types

### `Result<T, E>`

Discriminated union for functional error handling.

```typescript
type Result<T, E = Error> = Ok<T> | Err<E>
```

**Usage:**

```typescript
import type { Result } from '@socketregistry/packageurl-js'

function parseConfig(): Result<Config, ValidationError> {
  // ...
}

const result = parseConfig()
if (result.kind === 'ok') {
  console.log(result.value) // Type: Config
} else {
  console.error(result.error) // Type: ValidationError
}
```

---

### `Ok<T>`

Successful result containing a value.

```typescript
class Ok<T> {
  readonly kind: 'ok'
  readonly value: T

  isOk(): this is Ok<T>
  isErr(): false
  unwrap(): T
  unwrapOr(defaultValue: T): T
  map<U>(fn: (value: T) => U): Result<U, never>
  andThen<U, F>(fn: (value: T) => Result<U, F>): Result<U, F>
}
```

**Usage:**

```typescript
import { ok } from '@socketregistry/packageurl-js'

const result = ok('success')
result.isOk() // -> true
result.unwrap() // -> 'success'
```

---

### `Err<E>`

Error result containing an error.

```typescript
class Err<E = Error> {
  readonly kind: 'err'
  readonly error: E

  isOk(): false
  isErr(): this is Err<E>
  unwrap(): never // throws
  unwrapOr<T>(defaultValue: T): T
  mapErr<F>(fn: (error: E) => F): Result<never, F>
  orElse<U>(fn: (error: E) => Result<U, never>): Result<U, never>
}
```

**Usage:**

```typescript
import { err } from '@socketregistry/packageurl-js'

const result = err(new Error('failed'))
result.isErr() // -> true
result.error.message // -> 'failed'
```

---

## Constants

### `PurlQualifierNames`

Constants for standard PURL qualifier keys.

```typescript
import { PurlQualifierNames } from '@socketregistry/packageurl-js'

const qualifiers = {
  [PurlQualifierNames.Checksum]: 'sha256:abc123',
  [PurlQualifierNames.DownloadUrl]: 'https://example.com/package.tar.gz',
}
```

**Available constants:**

- `RepositoryUrl` = `'repository_url'`
- `DownloadUrl` = `'download_url'`
- `VcsUrl` = `'vcs_url'`
- `FileName` = `'file_name'`
- `Checksum` = `'checksum'`

---

## Importing Types

All types can be imported from the main entry point:

```typescript
import type {
  // PURL types
  PackageURLObject,
  PackageURLComponentValue,
  ParsedPurlComponents,

  // Parser types
  NpmPackageComponents,

  // Component types
  QualifiersObject,
  QualifiersValue,
  ComponentEncoder,
  ComponentNormalizer,
  ComponentValidator,

  // URL types
  RepositoryUrl,
  DownloadUrl,

  // Result types
  Result,
} from '@socketregistry/packageurl-js'
```

**Constants (value imports):**

```typescript
import {
  PurlQualifierNames,
  PURL_Type,
  PurlType,
  PurlComponent,
} from '@socketregistry/packageurl-js'
```

---

## Type Guards

### Result Type Guards

```typescript
import type { Result } from '@socketregistry/packageurl-js'

function processResult<T, E>(result: Result<T, E>) {
  if (result.isOk()) {
    // TypeScript knows result is Ok<T>
    console.log(result.value)
  } else {
    // TypeScript knows result is Err<E>
    console.error(result.error)
  }

  // Using discriminated union
  if (result.kind === 'ok') {
    console.log(result.value)
  } else {
    console.error(result.error)
  }
}
```

---

## Advanced Usage

### Generic Constraints

```typescript
import type { PackageURLObject, Result } from '@socketregistry/packageurl-js'

function validatePurl<T extends PackageURLObject>(
  obj: T,
): Result<T, ValidationError> {
  // ...
}
```

### Type Inference

```typescript
import { parseNpmSpecifier } from '@socketregistry/packageurl-js'

// Type is inferred as NpmPackageComponents
const components = parseNpmSpecifier('lodash@4.17.21')

// Destructuring with type inference
const { namespace, name, version } = components
```

### Conditional Types

```typescript
import type { Result, Ok, Err } from '@socketregistry/packageurl-js'

type ExtractValue<T> = T extends Ok<infer U> ? U : never
type ExtractError<T> = T extends Err<infer E> ? E : never
```

---

## See Also

- [API Reference](api.md) - Complete API documentation
- [Package URL Specification](https://github.com/package-url/purl-spec) - Official purl spec
