# Builder Pattern Guide

Complete guide to using `PackageURLBuilder` for fluent Package URL construction.

## Overview

The builder pattern provides a readable, chainable API for constructing Package URLs. Each builder method returns the builder instance, enabling fluent method chaining.

```typescript
import { PackageURLBuilder } from '@socketregistry/packageurl-js'

const purl = PackageURLBuilder.npm()
  .name('express')
  .version('4.18.0')
  .build()
```

## Factory Methods

Pre-configured builders for popular package ecosystems.

### npm - JavaScript/Node.js

```typescript
PackageURLBuilder.npm()
  .name('lodash')
  .version('4.17.21')
  .build()
// 'pkg:npm/lodash@4.17.21'

// Scoped packages
PackageURLBuilder.npm()
  .namespace('@babel')
  .name('core')
  .version('7.20.0')
  .build()
// 'pkg:npm/%40babel/core@7.20.0'

// With subpath
PackageURLBuilder.npm()
  .name('lodash')
  .version('4.17.21')
  .subpath('fp/compose.js')
  .build()
// 'pkg:npm/lodash@4.17.21#fp/compose.js'
```

---

### pypi - Python

```typescript
PackageURLBuilder.pypi()
  .name('requests')
  .version('2.28.1')
  .build()
// 'pkg:pypi/requests@2.28.1'

PackageURLBuilder.pypi()
  .name('django')
  .version('4.1.0')
  .qualifier('os', 'linux')
  .build()
// 'pkg:pypi/django@4.1.0?os=linux'
```

**Notes:**
- Underscores in names are normalized to dashes
- Names are case-insensitive (normalized to lowercase)

---

### maven - Java

```typescript
PackageURLBuilder.maven()
  .namespace('org.springframework')
  .name('spring-core')
  .version('5.3.21')
  .build()
// 'pkg:maven/org.springframework/spring-core@5.3.21'

// With classifier
PackageURLBuilder.maven()
  .namespace('org.apache.commons')
  .name('commons-lang3')
  .version('3.12.0')
  .qualifier('classifier', 'sources')
  .qualifier('type', 'jar')
  .build()
// 'pkg:maven/org.apache.commons/commons-lang3@3.12.0?classifier=sources&type=jar'
```

**Notes:**
- `namespace` maps to Maven groupId
- Common qualifiers: `classifier`, `type`, `repository_url`

---

### gem - Ruby

```typescript
PackageURLBuilder.gem()
  .name('rails')
  .version('7.0.4')
  .build()
// 'pkg:gem/rails@7.0.4'

PackageURLBuilder.gem()
  .name('devise')
  .version('4.8.1')
  .qualifier('platform', 'ruby')
  .build()
// 'pkg:gem/devise@4.8.1?platform=ruby'
```

**Notes:**
- Common qualifiers: `platform`

---

### cargo - Rust

```typescript
PackageURLBuilder.cargo()
  .name('serde')
  .version('1.0.152')
  .build()
// 'pkg:cargo/serde@1.0.152'

PackageURLBuilder.cargo()
  .name('tokio')
  .version('1.25.0')
  .qualifier('features', 'full')
  .build()
// 'pkg:cargo/tokio@1.25.0?features=full'
```

---

### nuget - .NET

```typescript
PackageURLBuilder.nuget()
  .name('Newtonsoft.Json')
  .version('13.0.2')
  .build()
// 'pkg:nuget/Newtonsoft.Json@13.0.2'

PackageURLBuilder.nuget()
  .namespace('Microsoft')
  .name('Extensions.Logging')
  .version('7.0.0')
  .build()
// 'pkg:nuget/Microsoft/Extensions.Logging@7.0.0'
```

---

### composer - PHP

```typescript
PackageURLBuilder.composer()
  .namespace('symfony')
  .name('console')
  .version('6.2.5')
  .build()
// 'pkg:composer/symfony/console@6.2.5'

PackageURLBuilder.composer()
  .namespace('laravel')
  .name('framework')
  .version('10.0.3')
  .build()
// 'pkg:composer/laravel/framework@10.0.3'
```

**Notes:**
- Both namespace and name are case-insensitive (normalized to lowercase)

---

### golang - Go

```typescript
PackageURLBuilder.golang()
  .namespace('github.com/gin-gonic')
  .name('gin')
  .version('v1.8.1')
  .build()
// 'pkg:golang/github.com/gin-gonic/gin@v1.8.1'

PackageURLBuilder.golang()
  .namespace('golang.org/x')
  .name('crypto')
  .version('v0.5.0')
  .build()
// 'pkg:golang/golang.org/x/crypto@v0.5.0'
```

**Notes:**
- `namespace` typically includes the repository host and path
- Go module names are case-sensitive

---

## Additional Package Types

While builder factory methods are provided for the most common ecosystems, you can build URLs for any package type using the generic builder:

### Custom Type Builder

```typescript
// Using generic builder
PackageURLBuilder.create()
  .type('docker')
  .name('nginx')
  .version('1.23.0')
  .build()
// 'pkg:docker/nginx@1.23.0'

// Supported types without dedicated factory methods
const types = [
  'alpm',      // Arch Linux
  'apk',       // Alpine Linux
  'bitbucket', // Bitbucket
  'bitnami',   // Bitnami
  'cocoapods', // CocoaPods (iOS/macOS)
  'deb',       // Debian/Ubuntu
  'docker',    // Docker
  'github',    // GitHub
  'gitlab',    // GitLab
  'hex',       // Erlang/Elixir
  'huggingface', // Hugging Face models
  'luarocks',  // Lua
  'mlflow',    // MLflow models
  'oci',       // OCI containers
  'pub',       // Dart/Flutter
  'qpkg',      // QNAP packages
  'rpm',       // RedHat/CentOS/Fedora
  'swift',     // Swift
]

// Example: Debian package
PackageURLBuilder.create()
  .type('deb')
  .namespace('debian')
  .name('curl')
  .version('7.88.1-1')
  .qualifier('arch', 'amd64')
  .build()
// 'pkg:deb/debian/curl@7.88.1-1?arch=amd64'
```

---

## Builder Methods

### Core Methods

#### `type(type: string)`

Set the package type.

```typescript
new PackageURLBuilder()
  .type('npm')
  .name('lodash')
  .build()
```

---

#### `name(name: string)` (Required)

Set the package name.

```typescript
PackageURLBuilder.npm()
  .name('express')
  .version('4.18.0')
  .build()
```

---

#### `namespace(namespace: string)`

Set the package namespace, scope, or organization.

```typescript
// npm scope
PackageURLBuilder.npm()
  .namespace('@babel')
  .name('core')
  .build()

// Maven groupId
PackageURLBuilder.maven()
  .namespace('org.springframework')
  .name('spring-core')
  .build()

// Go module path
PackageURLBuilder.golang()
  .namespace('github.com/gin-gonic')
  .name('gin')
  .build()
```

---

#### `version(version: string)`

Set the package version.

```typescript
PackageURLBuilder.npm()
  .name('lodash')
  .version('4.17.21')
  .build()
```

---

#### `qualifier(key: string, value: string)`

Add a single qualifier. Can be called multiple times.

```typescript
PackageURLBuilder.maven()
  .namespace('org.apache')
  .name('commons-lang3')
  .version('3.12.0')
  .qualifier('classifier', 'sources')
  .qualifier('type', 'jar')
  .build()
```

---

#### `qualifiers(qualifiers: Record<string, string>)`

Set all qualifiers at once.

```typescript
PackageURLBuilder.maven()
  .namespace('org.apache')
  .name('commons-lang3')
  .version('3.12.0')
  .qualifiers({
    classifier: 'sources',
    type: 'jar',
    repository_url: 'https://repo.maven.apache.org'
  })
  .build()
```

---

#### `subpath(subpath: string)`

Set the subpath within the package.

```typescript
PackageURLBuilder.npm()
  .name('lodash')
  .version('4.17.21')
  .subpath('fp/compose.js')
  .build()
// 'pkg:npm/lodash@4.17.21#fp/compose.js'
```

---

#### `build()`

Construct the final PackageURL instance.

```typescript
const purl = PackageURLBuilder.npm()
  .name('express')
  .version('4.18.0')
  .build()

console.log(purl.toString())  // 'pkg:npm/express@4.18.0'
```

---

## Advanced Patterns

### Building from Existing PURL

```typescript
import { PackageURL, PackageURLBuilder } from '@socketregistry/packageurl-js'

const original = PackageURL.fromString('pkg:npm/lodash@4.17.21')

// Create modified version
const modified = PackageURLBuilder.from(original)
  .version('4.17.20')
  .build()

console.log(modified.toString())  // 'pkg:npm/lodash@4.17.20'
```

---

### Conditional Building

```typescript
const builder = PackageURLBuilder.npm()
  .name('my-package')

// Conditionally add version
if (version) {
  builder.version(version)
}

// Conditionally add qualifiers
if (isDevelopment) {
  builder.qualifier('environment', 'dev')
}

const purl = builder.build()
```

---

### Dynamic Type Selection

```typescript
function createPurl(type: string, name: string, version: string) {
  const factories: Record<string, () => PackageURLBuilder> = {
    npm: () => PackageURLBuilder.npm(),
    pypi: () => PackageURLBuilder.pypi(),
    maven: () => PackageURLBuilder.maven(),
    gem: () => PackageURLBuilder.gem(),
    cargo: () => PackageURLBuilder.cargo(),
  }

  const factory = factories[type] || (() => PackageURLBuilder.create().type(type))

  return factory()
    .name(name)
    .version(version)
    .build()
}

const npmPurl = createPurl('npm', 'express', '4.18.0')
const pypiPurl = createPurl('pypi', 'requests', '2.28.1')
```

---

### Batch Building

```typescript
const dependencies = [
  { name: 'express', version: '4.18.0' },
  { name: 'lodash', version: '4.17.21' },
  { name: 'react', version: '18.0.0' },
]

const purls = dependencies.map(({ name, version }) =>
  PackageURLBuilder.npm()
    .name(name)
    .version(version)
    .build()
    .toString()
)
```

---

## Common Qualifiers by Type

### npm
- `repository_url` - Custom registry URL
- `download_url` - Direct download URL
- `vcs_url` - Version control URL

### pypi
- `extension` - Package format (tar.gz, whl)
- `os` - Target operating system
- `arch` - Target architecture

### maven
- `classifier` - Artifact classifier (sources, javadoc)
- `type` - Packaging type (jar, war, pom)
- `repository_url` - Maven repository URL

### docker/oci
- `repository_url` - Registry URL
- `tag` - Image tag
- `digest` - Content digest

### gem
- `platform` - Target platform (ruby, java)

### cargo
- `features` - Enabled features

### deb/rpm
- `arch` - Target architecture (amd64, arm64)
- `distro` - Distribution name/version

---

## Validation

The builder performs validation when `build()` is called:

```typescript
try {
  const purl = PackageURLBuilder.npm()
    // Missing required 'name'
    .version('1.0.0')
    .build()
} catch (error) {
  console.error('Validation failed:', error.message)
}
```

---

## Type-Specific Normalization

Some package types apply automatic normalization:

### npm
- Namespace (scope) is lowercased: `@Babel` → `@babel`
- Name is lowercased (except legacy packages)

### pypi
- Name underscores converted to dashes: `my_package` → `my-package`
- Name is lowercased

### composer
- Namespace and name are lowercased

### pub (Dart)
- Name dashes converted to underscores
- Name is lowercased

---

## Best Practices

1. **Use factory methods** when available for better IDE support
2. **Chain methods** for readable construction
3. **Validate early** by calling `build()` as soon as possible
4. **Use qualifiers** for ecosystem-specific metadata
5. **Leverage `from()`** for creating modified versions of existing PURLs

---

## See Also

- [API Reference](./API.md) - Complete API documentation
- [Examples](./EXAMPLES.md) - Practical usage examples
- [PURL Types Specification](https://github.com/package-url/purl-spec/blob/master/PURL-TYPES.rst) - Official type definitions
