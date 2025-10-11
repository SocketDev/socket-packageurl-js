# Examples

Practical usage examples for `@socketregistry/packageurl-js`.

## Parsing Package URLs

### Basic Parsing

```typescript
import { PackageURL } from '@socketregistry/packageurl-js'

// Parse npm package
const npm = PackageURL.fromString('pkg:npm/lodash@4.17.21')
console.log(npm.type)     // 'npm'
console.log(npm.name)     // 'lodash'
console.log(npm.version)  // '4.17.21'

// Parse scoped npm package
const scoped = PackageURL.fromString('pkg:npm/%40babel/core@7.20.0')
console.log(scoped.namespace)  // '@babel'
console.log(scoped.name)       // 'core'

// Parse Python package
const pypi = PackageURL.fromString('pkg:pypi/django@4.1.0')
console.log(pypi.type)     // 'pypi'
console.log(pypi.name)     // 'django'
console.log(pypi.version)  // '4.1.0'
```

### Parsing with Qualifiers

```typescript
import { PackageURL } from '@socketregistry/packageurl-js'

const maven = PackageURL.fromString(
  'pkg:maven/org.springframework/spring-core@5.3.21?classifier=sources&type=jar'
)

console.log(maven.namespace)  // 'org.springframework'
console.log(maven.name)       // 'spring-core'
console.log(maven.qualifiers) // { classifier: 'sources', type: 'jar' }
```

### Parsing with Subpaths

```typescript
import { PackageURL } from '@socketregistry/packageurl-js'

const withSubpath = PackageURL.fromString(
  'pkg:npm/lodash@4.17.21#helpers/isArray.js'
)

console.log(withSubpath.name)    // 'lodash'
console.log(withSubpath.subpath) // 'helpers/isArray.js'
```

### Auto-Detection

```typescript
import { PackageURL } from '@socketregistry/packageurl-js'

// Automatically prepends 'pkg:' if missing
const auto = PackageURL.fromString('npm/express@4.18.0')
console.log(auto.toString())  // 'pkg:npm/express@4.18.0'
```

## Building Package URLs

### npm Packages

```typescript
import { PackageURLBuilder } from '@socketregistry/packageurl-js'

// Simple package
const lodash = PackageURLBuilder.npm()
  .name('lodash')
  .version('4.17.21')
  .build()
console.log(lodash.toString())  // 'pkg:npm/lodash@4.17.21'

// Scoped package
const react = PackageURLBuilder.npm()
  .namespace('@types')
  .name('react')
  .version('18.0.0')
  .build()
console.log(react.toString())  // 'pkg:npm/%40types/react@18.0.0'

// With subpath
const util = PackageURLBuilder.npm()
  .name('lodash')
  .version('4.17.21')
  .subpath('fp/compose.js')
  .build()
console.log(util.toString())  // 'pkg:npm/lodash@4.17.21#fp/compose.js'
```

### Python Packages

```typescript
import { PackageURLBuilder } from '@socketregistry/packageurl-js'

const requests = PackageURLBuilder.pypi()
  .name('requests')
  .version('2.28.1')
  .build()
console.log(requests.toString())  // 'pkg:pypi/requests@2.28.1'

const django = PackageURLBuilder.pypi()
  .name('django')
  .version('4.1.0')
  .qualifier('os', 'linux')
  .build()
console.log(django.toString())  // 'pkg:pypi/django@4.1.0?os=linux'
```

### Maven Packages

```typescript
import { PackageURLBuilder } from '@socketregistry/packageurl-js'

const springCore = PackageURLBuilder.maven()
  .namespace('org.springframework')
  .name('spring-core')
  .version('5.3.21')
  .build()
console.log(springCore.toString())
// 'pkg:maven/org.springframework/spring-core@5.3.21'

// With qualifiers
const sources = PackageURLBuilder.maven()
  .namespace('org.apache.commons')
  .name('commons-lang3')
  .version('3.12.0')
  .qualifier('classifier', 'sources')
  .qualifier('type', 'jar')
  .build()
console.log(sources.toString())
// 'pkg:maven/org.apache.commons/commons-lang3@3.12.0?classifier=sources&type=jar'
```

### Ruby Gems

```typescript
import { PackageURLBuilder } from '@socketregistry/packageurl-js'

const rails = PackageURLBuilder.gem()
  .name('rails')
  .version('7.0.4')
  .build()
console.log(rails.toString())  // 'pkg:gem/rails@7.0.4'

const devise = PackageURLBuilder.gem()
  .name('devise')
  .version('4.8.1')
  .qualifier('platform', 'ruby')
  .build()
```

### Rust Crates

```typescript
import { PackageURLBuilder } from '@socketregistry/packageurl-js'

const serde = PackageURLBuilder.cargo()
  .name('serde')
  .version('1.0.152')
  .build()
console.log(serde.toString())  // 'pkg:cargo/serde@1.0.152'
```

### Go Modules

```typescript
import { PackageURLBuilder } from '@socketregistry/packageurl-js'

const gin = PackageURLBuilder.golang()
  .namespace('github.com/gin-gonic')
  .name('gin')
  .version('v1.8.1')
  .build()
console.log(gin.toString())
// 'pkg:golang/github.com/gin-gonic/gin@v1.8.1'
```

### Docker Images

```typescript
import { PackageURLBuilder } from '@socketregistry/packageurl-js'

const nginx = PackageURLBuilder.docker()
  .name('nginx')
  .version('1.23.0')
  .build()
console.log(nginx.toString())  // 'pkg:docker/nginx@1.23.0'

const custom = PackageURLBuilder.docker()
  .namespace('myorg')
  .name('myapp')
  .version('2.1.0')
  .qualifier('tag', 'alpine')
  .build()
```

## Constructor API

```typescript
import { PackageURL } from '@socketregistry/packageurl-js'

// npm package
const npm = new PackageURL('npm', null, 'express', '4.18.0', null, null)
console.log(npm.toString())  // 'pkg:npm/express@4.18.0'

// Scoped npm
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

// With subpath
const withSubpath = new PackageURL(
  'npm',
  null,
  'lodash',
  '4.17.21',
  null,
  'helpers/isArray.js'
)
```

## URL Conversion

### Repository URLs

```typescript
import { PackageURL, UrlConverter } from '@socketregistry/packageurl-js'

const purl = PackageURL.fromString('pkg:npm/express@4.18.0')
const repo = UrlConverter.toRepositoryUrl(purl)

if (repo) {
  console.log(repo.type)  // 'git'
  console.log(repo.url)   // 'https://github.com/expressjs/express'
}
```

### Download URLs

```typescript
import { PackageURL, UrlConverter } from '@socketregistry/packageurl-js'

const purl = PackageURL.fromString('pkg:npm/lodash@4.17.21')
const download = UrlConverter.toDownloadUrl(purl)

if (download) {
  console.log(download.type)  // 'tarball'
  console.log(download.url)
  // 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz'
}
```

### Get All URLs

```typescript
import { PackageURL, UrlConverter } from '@socketregistry/packageurl-js'

const purl = PackageURL.fromString('pkg:npm/react@18.0.0')
const urls = UrlConverter.getAllUrls(purl)

if (urls.repository) {
  console.log('Repository:', urls.repository.url)
}

if (urls.download) {
  console.log('Download:', urls.download.url)
}
```

### Check Support

```typescript
import { UrlConverter } from '@socketregistry/packageurl-js'

console.log(UrlConverter.supportsRepositoryUrl('npm'))   // true
console.log(UrlConverter.supportsDownloadUrl('pypi'))    // true
console.log(UrlConverter.supportsRepositoryUrl('custom')) // false
```

## Serialization

### To/From JSON

```typescript
import { PackageURL } from '@socketregistry/packageurl-js'

// Create purl
const purl = PackageURLBuilder.npm()
  .name('express')
  .version('4.18.0')
  .build()

// Serialize to JSON string
const json = purl.toJSONString()
console.log(json)
// '{"type":"npm","name":"express","version":"4.18.0"}'

// Deserialize from JSON string
const restored = PackageURL.fromJSON(json)
console.log(restored.toString())  // 'pkg:npm/express@4.18.0'
```

### To/From Object

```typescript
import { PackageURL } from '@socketregistry/packageurl-js'

// Create purl
const purl = PackageURL.fromString('pkg:npm/@babel/core@7.20.0')

// Convert to object
const obj = purl.toObject()
console.log(obj)
// {
//   type: 'npm',
//   namespace: '@babel',
//   name: 'core',
//   version: '7.20.0'
// }

// Create from object
const restored = PackageURL.fromObject(obj)
console.log(restored.toString())  // 'pkg:npm/%40babel/core@7.20.0'
```

### JSON.stringify Integration

```typescript
import { PackageURL } from '@socketregistry/packageurl-js'

const purl = PackageURL.fromString('pkg:npm/lodash@4.17.21')

// Works with JSON.stringify
const json = JSON.stringify({ package: purl })
console.log(json)
// '{"package":{"type":"npm","name":"lodash","version":"4.17.21"}}'
```

## Working with Components

### Accessing Components

```typescript
import { PackageURL } from '@socketregistry/packageurl-js'

const purl = PackageURL.fromString(
  'pkg:maven/org.apache/commons@3.12.0?classifier=sources#src/main'
)

console.log(purl.type)       // 'maven'
console.log(purl.namespace)  // 'org.apache'
console.log(purl.name)       // 'commons'
console.log(purl.version)    // '3.12.0'
console.log(purl.qualifiers) // { classifier: 'sources' }
console.log(purl.subpath)    // 'src/main'
```

### Parsing Components

```typescript
import { PackageURL } from '@socketregistry/packageurl-js'

const parts = PackageURL.parseString('pkg:npm/@babel/core@7.20.0')
const [type, namespace, name, version, qualifiers, subpath] = parts

console.log(type)       // 'npm'
console.log(namespace)  // '@babel'
console.log(name)       // 'core'
console.log(version)    // '7.20.0'
```

## Error Handling

### Validation Errors

```typescript
import { PackageURL } from '@socketregistry/packageurl-js'

try {
  // Missing required 'name' component
  PackageURL.fromString('pkg:npm/@babel')
} catch (error) {
  console.error('Invalid purl:', error.message)
}

try {
  // Invalid JSON
  PackageURL.fromJSON('not valid json')
} catch (error) {
  console.error('JSON parse error:', error.message)
}
```

### Type Validation

```typescript
import { PackageURL } from '@socketregistry/packageurl-js'

try {
  // Not a string
  PackageURL.fromString(123)
} catch (error) {
  console.error('Type error:', error.message)
  // 'A purl string argument is required.'
}
```

## Batch Processing

### Processing Multiple Packages

```typescript
import { PackageURL } from '@socketregistry/packageurl-js'

const purls = [
  'pkg:npm/lodash@4.17.21',
  'pkg:pypi/django@4.1.0',
  'pkg:maven/org.apache/commons@3.12.0'
]

const packages = purls.map(purl => PackageURL.fromString(purl))

packages.forEach(pkg => {
  console.log(`${pkg.type}: ${pkg.name}@${pkg.version}`)
})
```

### Filtering by Type

```typescript
import { PackageURL } from '@socketregistry/packageurl-js'

const packages = [
  PackageURL.fromString('pkg:npm/express@4.18.0'),
  PackageURL.fromString('pkg:pypi/requests@2.28.1'),
  PackageURL.fromString('pkg:npm/lodash@4.17.21')
]

const npmPackages = packages.filter(pkg => pkg.type === 'npm')
console.log(`Found ${npmPackages.length} npm packages`)
```

## Integration Examples

### Dependency Analysis

```typescript
import { PackageURL, UrlConverter } from '@socketregistry/packageurl-js'
import { readFile } from 'fs/promises'

async function analyzeDependencies(packageJsonPath: string) {
  const pkg = JSON.parse(await readFile(packageJsonPath, 'utf8'))

  for (const [name, version] of Object.entries(pkg.dependencies)) {
    const purl = PackageURLBuilder.npm()
      .name(name)
      .version(version as string)
      .build()

    const urls = UrlConverter.getAllUrls(purl)

    console.log(`${name}@${version}`)
    if (urls.repository) {
      console.log(`  Repository: ${urls.repository.url}`)
    }
    if (urls.download) {
      console.log(`  Download: ${urls.download.url}`)
    }
  }
}
```

### Security Scanning

```typescript
import { PackageURL } from '@socketregistry/packageurl-js'

interface VulnerabilityReport {
  purl: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  cve: string
}

function checkVulnerabilities(packages: string[]): VulnerabilityReport[] {
  return packages
    .map(purlStr => PackageURL.fromString(purlStr))
    .filter(purl => {
      // Filter logic here
      return purl.type === 'npm' && purl.version
    })
    .map(purl => ({
      purl: purl.toString(),
      severity: 'high' as const,
      cve: 'CVE-2023-xxxxx'
    }))
}
```

### SBOM Generation

```typescript
import { PackageURL } from '@socketregistry/packageurl-js'

interface SBOMComponent {
  type: string
  name: string
  version: string
  purl: string
}

function generateSBOM(dependencies: Record<string, string>): SBOMComponent[] {
  return Object.entries(dependencies).map(([name, version]) => {
    const purl = PackageURLBuilder.npm()
      .name(name)
      .version(version)
      .build()

    return {
      type: 'library',
      name,
      version,
      purl: purl.toString()
    }
  })
}
```

## Advanced Patterns

### Custom Package Types

```typescript
import { PackageURL } from '@socketregistry/packageurl-js'

// Use constructor for custom types
const custom = new PackageURL(
  'custom-type',
  'my-org',
  'my-package',
  '1.0.0',
  { environment: 'production' },
  null
)

console.log(custom.toString())
// 'pkg:custom-type/my-org/my-package@1.0.0?environment=production'
```

### Qualifier Manipulation

```typescript
import { PackageURLBuilder } from '@socketregistry/packageurl-js'

const base = PackageURLBuilder.maven()
  .namespace('org.example')
  .name('mylib')
  .version('1.0.0')

// Add qualifiers one by one
const withClassifier = base
  .qualifier('classifier', 'sources')
  .build()

// Set multiple qualifiers
const withMultiple = PackageURLBuilder.maven()
  .namespace('org.example')
  .name('mylib')
  .version('1.0.0')
  .qualifiers({
    classifier: 'sources',
    type: 'jar',
    repository_url: 'https://repo.maven.org'
  })
  .build()
```

### Type Guards and Validation

```typescript
import { PackageURL } from '@socketregistry/packageurl-js'

function isNpmPackage(purl: PackageURL): boolean {
  return purl.type === 'npm'
}

function hasVersion(purl: PackageURL): boolean {
  return purl.version !== undefined
}

const purl = PackageURL.fromString('pkg:npm/lodash@4.17.21')

if (isNpmPackage(purl) && hasVersion(purl)) {
  console.log(`npm package with version: ${purl.version}`)
}
```

## See Also

- [API Reference](./API.md) - Complete API documentation
- [Builder Guide](./BUILDERS.md) - Builder pattern reference
- [Package URL Spec](https://github.com/package-url/purl-spec) - Official specification
