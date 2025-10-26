# Getting Started with PackageURL-JS Development

Welcome to @socketregistry/packageurl-js! This guide will help you set up your development environment and start contributing to this TypeScript Package URL (purl) implementation.

## Quick Start

```bash
# Clone the repository
git clone https://github.com/SocketDev/socket-packageurl-js.git
cd socket-packageurl-js

# Install dependencies
pnpm install

# Build the library
pnpm run build

# Run tests
pnpm test

# Run checks (lint + type check)
pnpm run check
```

You're ready to develop!

## Prerequisites

**Required:**
- **Node.js** 18.20.4 or higher (20, 22, 24 recommended)
- **pnpm** 10.16.0 or higher

**Recommended:**
- **Git** 2.0 or higher
- **VSCode** with recommended extensions

**Install pnpm:**
```bash
npm install -g pnpm
# or
brew install pnpm
```

## Repository Structure

```
socket-packageurl-js/
├── docs/                   # Documentation
│   ├── api-reference.md    # Complete API documentation
│   ├── builder-pattern.md  # Builder pattern guide
│   └── usage-examples.md   # Practical examples
├── src/                    # TypeScript source code
│   ├── index.ts            # Main entry point
│   ├── package-url.ts      # Core PackageURL class
│   ├── package-url-builder.ts  # Builder pattern
│   ├── purl-type.ts        # Type-specific handling
│   ├── validate.ts         # Validation logic
│   ├── normalize.ts        # Type normalization
│   ├── encode.ts           # URL encoding
│   ├── decode.ts           # URL decoding
│   ├── url-converter.ts    # URL conversion
│   ├── result.ts           # Result<T> type (Ok/Err)
│   └── helpers.ts          # Helper functions
├── test/                   # Test suites (14+ test files)
│   ├── package-url.test.mts
│   ├── purl-spec.test.mts  # Spec compliance tests
│   ├── purl-edge-cases.test.mts  # Edge cases (95KB!)
│   └── utils/              # Test helpers
├── data/npm/               # NPM package data
│   ├── builtin-names.json  # Node.js built-ins
│   └── legacy-names.json   # Legacy npm packages
├── dist/                   # Compiled CommonJS output
├── scripts/                # Build and dev scripts
├── .config/                # Configuration files
├── CLAUDE.md               # Project guidelines
├── README.md               # Package documentation
└── package.json            # Dependencies and scripts
```

## Development Workflow

### 1. Initial Setup

```bash
# Clone and install
git clone https://github.com/SocketDev/socket-packageurl-js.git
cd socket-packageurl-js
pnpm install
```

### 2. Build the Library

```bash
# Full build
pnpm run build

# Watch mode (68% faster incremental: 9ms vs 27ms)
pnpm run build --watch
```

**Build output:**
- `dist/index.js` - Main CommonJS bundle (minified)
- `dist/index.d.ts` - TypeScript declarations

### 3. Run Tests

```bash
# Run all tests
pnpm test

# Run specific test
pnpm test package-url.test.mts

# Run with coverage
pnpm run cover
```

**Coverage requirement:** 100% (strictly enforced)

### 4. Verify Changes

```bash
# Run all checks (lint + type check)
pnpm run check

# Auto-fix issues
pnpm run fix

# Type check only
pnpm run type
```

### 5. Before Committing

```bash
# This runs automatically via pre-commit hook:
pnpm run precommit
```

**Pre-commit hooks run:**
- Linting on staged files
- Type checking
- Tests (if needed)

## Understanding Package URLs (PURLs)

### What is a PURL?

A Package URL (purl) is a standardized way to identify and locate software packages across ecosystems:

```
pkg:npm/lodash@4.17.21
pkg:pypi/requests@2.28.1
pkg:maven/org.springframework/spring-core@5.3.21
```

**Format:**
```
pkg:<type>/<namespace>/<name>@<version>?<qualifiers>#<subpath>

type       - Required (npm, pypi, maven, etc.)
namespace  - Optional (e.g., @babel for npm, org.springframework for maven)
name       - Required (package name)
version    - Optional (package version)
qualifiers - Optional (key=value pairs)
subpath    - Optional (path within package)
```

### Supported Ecosystems

This library supports 20+ package ecosystems:

- **npm** - Node.js packages
- **pypi** - Python packages
- **maven** - Java packages
- **gem** - Ruby packages
- **cargo** - Rust packages
- **nuget** - .NET packages
- **composer** - PHP packages
- **golang** - Go packages
- **And 15+ more**

See `src/purl-type.ts` for complete list.

## Common Development Tasks

### Adding Support for a New Ecosystem

**1. Add type to `src/purl-type.ts`:**

```typescript
export const PURL_Type = Object.freeze({
  // ... existing types
  NEW_TYPE: 'newtype',
} as const)

// Update type union
export type EcosystemString =
  | 'npm'
  | 'pypi'
  // ... existing
  | 'newtype'  // Add here
```

**2. Add validation in `src/validate.ts`:**

```typescript
function validateNewtype(components: PurlComponents): Result<void> {
  // Validate type-specific requirements
  if (!components.name) {
    return Err(new PurlError('name is required for newtype'))
  }
  return Ok(undefined)
}
```

**3. Add normalization in `src/normalize.ts`:**

```typescript
function normalizeNewtype(components: PurlComponents): PurlComponents {
  // Apply type-specific normalization
  return {
    ...components,
    name: components.name.toLowerCase()  // Example
  }
}
```

**4. Add builder method in `src/package-url-builder.ts`:**

```typescript
static newtype(): PackageURLBuilder {
  return new PackageURLBuilder('newtype')
}
```

**5. Write tests:**

```typescript
describe('newtype support', () => {
  it('should parse newtype purl', () => {
    const purl = PackageURL.fromString('pkg:newtype/example@1.0.0')
    expect(purl.type).toBe('newtype')
    expect(purl.name).toBe('example')
  })

  it('should build newtype purl', () => {
    const purl = PackageURLBuilder.newtype()
      .name('example')
      .version('1.0.0')
      .build()
    expect(purl).toBe('pkg:newtype/example@1.0.0')
  })
})
```

**6. Update documentation:**
- Add to `docs/api-reference.md`
- Add examples to `docs/usage-examples.md`

### Fixing a Validation Bug

**1. Identify the issue:**

Run tests to see failures:
```bash
pnpm test
```

**2. Add failing test:**

```typescript
it('should handle invalid namespace', () => {
  const result = PackageURL.fromString('pkg:npm/Invalid@Name/pkg@1.0.0')
  // Should fail validation
  expect(result).toBeInstanceOf(Error)
})
```

**3. Fix validation logic:**

Update `src/validate.ts`:
```typescript
function validateNamespace(namespace: string | null): Result<void> {
  if (namespace && !/^[a-z0-9@-]+$/.test(namespace)) {
    return Err(new PurlError('Invalid namespace format'))
  }
  return Ok(undefined)
}
```

**4. Verify fix:**

```bash
pnpm test
pnpm run cover  # Ensure 100% coverage maintained
```

### Improving Type Safety

**Use Result<T> type** for error handling:

```typescript
import { Result, Ok, Err } from './result.js'

function parseComponent(input: string): Result<string> {
  if (!input) {
    return Err(new PurlError('Input is required'))
  }
  return Ok(input.toLowerCase())
}

// Usage:
const result = parseComponent('value')
if (result.ok) {
  console.log(result.value)  // Type-safe access
} else {
  console.error(result.error)  // Type-safe error
}
```

### Updating NPM Data

Update Node.js built-in and legacy package lists:

```bash
pnpm run update:data:npm
```

**Updates:**
- `data/npm/builtin-names.json` - Node.js built-in modules
- `data/npm/legacy-names.json` - Legacy/renamed npm packages

**Data sources:**
- Built-ins: Node.js documentation
- Legacy: npm registry metadata

## Testing Guide

### Test Structure

```
test/
├── package-url.test.mts              # Core class tests
├── package-url-builder.test.mts      # Builder tests
├── purl-spec.test.mts                # Spec compliance
├── purl-edge-cases.test.mts          # Edge cases (95KB!)
├── purl-types.test.mts               # Type-specific tests
├── url-converter.test.mts            # URL conversion
├── json-export.test.mts              # JSON serialization
├── package-url-json-security.test.mts # Security tests
└── utils/                            # Test utilities
    ├── test-helpers.mts              # Helper functions
    ├── param-validation.mts          # Validation helpers
    └── isolation.mjs                 # Test isolation
```

### Test Patterns

**Basic parsing test:**
```typescript
it('should parse npm purl', () => {
  const purl = PackageURL.fromString('pkg:npm/lodash@4.17.21')
  expect(purl.type).toBe('npm')
  expect(purl.name).toBe('lodash')
  expect(purl.version).toBe('4.17.21')
})
```

**Builder test:**
```typescript
it('should build maven purl with namespace', () => {
  const purl = PackageURLBuilder.maven()
    .namespace('org.apache')
    .name('commons-lang')
    .version('3.12.0')
    .build()
  expect(purl).toBe('pkg:maven/org.apache/commons-lang@3.12.0')
})
```

**Edge case test:**
```typescript
it('should handle special characters', () => {
  const purl = PackageURL.fromString('pkg:npm/@scope%2Fpkg@1.0.0')
  expect(purl.namespace).toBe('@scope')
  expect(purl.name).toBe('pkg')
})
```

**Spec compliance test:**
```typescript
import specData from './data/purl-spec-tests.json'

for (const testCase of specData) {
  it(testCase.description, () => {
    const purl = PackageURL.fromString(testCase.input)
    expect(purl.toString()).toBe(testCase.expected)
  })
}
```

### Running Tests

```bash
# All tests
pnpm test

# Specific file
pnpm test purl-edge-cases.test.mts

# Watch mode
pnpm test --watch

# Coverage (must be 100%)
pnpm run cover
```

## Code Style

**No semicolons** (differs from socket-sdk-js):
```typescript
const purl = new PackageURL('npm', null, 'lodash', '4.17.21')  // ✓ No semicolon
const str = purl.toString()  // ✓ No semicolon
```

**Other style rules:**
- `@fileoverview` headers on all files (MANDATORY)
- Type imports: `import type { Foo } from './types.js'`
- Node.js imports: `import path from 'node:path'` (with `node:` prefix)
- Alphabetical sorting (imports, exports, properties)
- No `any` type (use `unknown`)
- `__proto__: null` first in object literals

See [CLAUDE.md](../CLAUDE.md) for complete standards.

## Project Standards

**Read CLAUDE.md** - Essential reading! Contains:
- Code style and organization
- Testing requirements
- Documentation standards
- Git workflow
- Cross-platform compatibility (CRITICAL)

**Key highlights:**

**File naming:**
- `kebab-case.ts` for source files
- `lowercase-with-hyphens.md` for docs

**Commit messages:**
```
feat(parser): add support for golang purls

- Implement golang type validation
- Add normalization rules
- Update builder with golang() method
- Add comprehensive tests
```

**Pre-commit hooks:**
- Runs `pnpm run precommit`
- Lints staged files
- Runs type checking

## Troubleshooting

### Build Issues

**Problem:** Build fails with esbuild error

**Solution:**
```bash
pnpm run clean
rm -rf node_modules/.cache
pnpm run build
```

### Test Issues

**Problem:** Tests fail with "Cannot find module"

**Solution:**
```bash
# Ensure build is current
pnpm run build
pnpm test
```

**Problem:** Coverage below 100%

**Solution:**
```bash
pnpm run cover  # See uncovered lines
# Add tests for uncovered code
```

### Type Issues

**Problem:** TypeScript errors after changes

**Solution:**
```bash
pnpm run type  # See specific errors
# Fix type errors
pnpm run check  # Verify all passes
```

### Data Update Issues

**Problem:** NPM data out of date

**Solution:**
```bash
pnpm run update:data:npm
git add data/npm/*.json
git commit -m "chore(data): update npm data"
```

## Documentation

### Updating Documentation

**API Reference** (`docs/api-reference.md`):
- Update when adding/changing public API
- Include class/method signatures
- Add usage examples
- Document exceptions

**Usage Examples** (`docs/usage-examples.md`):
- Real-world scenarios
- Copy-paste ready code
- Cover common use cases

**Builder Pattern** (`docs/builder-pattern.md`):
- Builder method examples
- Fluent API patterns
- Type-specific builders

## Advanced Topics

### Result Type Pattern

This library uses a Result<T> type for error handling instead of throwing exceptions in many cases:

```typescript
import { Result, Ok, Err } from '@socketregistry/packageurl-js'

function safeParse(input: string): Result<PackageURL> {
  try {
    const purl = PackageURL.fromString(input)
    return Ok(purl)
  } catch (e) {
    return Err(e as Error)
  }
}

const result = safeParse('invalid')
if (result.ok) {
  console.log('Success:', result.value)
} else {
  console.error('Error:', result.error.message)
}
```

### Type-Specific Normalization

Different ecosystems have different normalization rules:

```typescript
// npm: lowercase names
'pkg:npm/Lodash@4.17.21' → 'pkg:npm/lodash@4.17.21'

// pypi: case-insensitive, normalized to lowercase
'pkg:pypi/Django@3.2' → 'pkg:pypi/django@3.2'

// maven: case-sensitive, no normalization
'pkg:maven/org.Apache/Commons@1.0' → 'pkg:maven/org.Apache/Commons@1.0'
```

See `src/normalize.ts` for implementation.

### URL Conversion

Convert purls to repository or download URLs:

```typescript
import { UrlConverter } from '@socketregistry/packageurl-js'

const purl = PackageURL.fromString('pkg:npm/lodash@4.17.21')

// Repository URL (GitHub, GitLab, etc.)
UrlConverter.toRepositoryUrl(purl)
// → 'https://github.com/lodash/lodash'

// Download URL (registry)
UrlConverter.toDownloadUrl(purl)
// → 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz'
```

### Security Considerations

**JSON serialization security:**
- Never trust JSON.parse() on untrusted input
- Validate all components after deserialization
- Use toJSON() for safe serialization

See `test/package-url-json-security.test.mts` for security tests.

## Next Steps

1. **Read the documentation:**
   - [api-reference.md](./api-reference.md) - Complete API
   - [usage-examples.md](./usage-examples.md) - Real-world examples
   - [builder-pattern.md](./builder-pattern.md) - Builder guide
   - [CLAUDE.md](../CLAUDE.md) - Project standards

2. **Explore the codebase:**
   - `src/package-url.ts` - Core implementation
   - `src/package-url-builder.ts` - Builder pattern
   - `src/purl-type.ts` - Type-specific logic
   - `test/` - Comprehensive test suite

3. **Pick a task:**
   - Browse open issues on GitHub
   - Add support for new ecosystem
   - Improve validation
   - Add test coverage
   - Fix a bug

4. **Join the community:**
   - Follow [@SocketSecurity](https://twitter.com/SocketSecurity) on Twitter
   - Follow [@socket.dev](https://bsky.app/profile/socket.dev) on Bluesky

## Quick Reference

### Essential Commands

| Command | Purpose |
|---------|---------|
| `pnpm install` | Install dependencies |
| `pnpm run build` | Build library |
| `pnpm test` | Run tests |
| `pnpm run cover` | Test coverage (100%) |
| `pnpm run check` | Lint + type check |
| `pnpm run fix` | Auto-fix issues |
| `pnpm run clean` | Clean artifacts |
| `pnpm run update:data:npm` | Update NPM data |

### Key Files

| What | Where |
|------|-------|
| Core class | `src/package-url.ts` |
| Builder | `src/package-url-builder.ts` |
| Type handling | `src/purl-type.ts` |
| Validation | `src/validate.ts` |
| Tests | `test/*.test.mts` |
| API docs | `docs/api-reference.md` |
| Examples | `docs/usage-examples.md` |
| Standards | `CLAUDE.md` |

### Help Resources

- **Main README**: [../README.md](../README.md)
- **API Reference**: [api-reference.md](./api-reference.md)
- **Usage Examples**: [usage-examples.md](./usage-examples.md)
- **Builder Pattern**: [builder-pattern.md](./builder-pattern.md)
- **Project Standards**: [../CLAUDE.md](../CLAUDE.md)
- **PURL Specification**: https://github.com/package-url/purl-spec

---

**Welcome to PackageURL-JS!** We're excited to have you contributing to this essential security infrastructure tool.
