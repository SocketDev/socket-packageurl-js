# Getting Started

Quick setup guide for contributing to `@socketregistry/packageurl-js`.

## Quick Start

```bash
git clone https://github.com/SocketDev/socket-packageurl-js.git
cd socket-packageurl-js
pnpm install          # Install dependencies
pnpm build            # Build library
pnpm test             # Run tests (100% coverage required)
```

**Requirements**: Node.js ≥18.20.4, pnpm ≥10.16.0

## Repository Structure

```
socket-packageurl-js/
├── src/                    # TypeScript source
│   ├── package-url.ts      # Core PackageURL class
│   ├── package-url-builder.ts  # Builder pattern
│   ├── purl-type.ts        # Type-specific handlers
│   ├── validate.ts         # Validation logic
│   └── normalize.ts        # Normalization rules
├── test/                   # Test suites (100% coverage)
├── docs/                   # Documentation
├── .config/                # Build & lint configs
├── CLAUDE.md               # Development guidelines
└── package.json            # Scripts & dependencies
```

## Essential Commands

| Command | Purpose |
|---------|---------|
| `pnpm build` | Production build (CommonJS) |
| `pnpm build --watch` | Watch mode (68% faster: 9ms vs 27ms) |
| `pnpm test` | Run all tests |
| `pnpm test <file>` | Run specific test file |
| `pnpm cover` | Coverage report (must be 100%) |
| `pnpm check` | Lint + type check |
| `pnpm fix` | Auto-fix lint issues |

## Development Workflow

### 1. Make Changes

Edit source files in `src/`. Key areas:

| Task | File(s) |
|------|---------|
| Add package type | `src/purl-type.ts` |
| Add validation | `src/validate.ts` |
| Add normalization | `src/normalize.ts` |
| Update builder | `src/package-url-builder.ts` |

### 2. Write Tests

Add tests in `test/`. Use test helpers:

```typescript
import { createTestPurl } from './utils/test-helpers.mts'

// Before: new PackageURL('npm', undefined, 'lodash', '4.17.21', undefined, undefined)
// After:
const purl = createTestPurl('npm', 'lodash', { version: '4.17.21' })
```

**Coverage requirement**: 100% (strictly enforced)

### 3. Verify Changes

```bash
pnpm check     # Lint + type check
pnpm test      # All tests
pnpm cover     # Verify 100% coverage
```

### 4. Commit

Pre-commit hooks run automatically:
- Lint staged files
- Type check
- Security checks

**Commit format** ([Conventional Commits](https://www.conventionalcommits.org/)):

```
<type>(<scope>): <description>

[optional body]
```

**Examples**:
- `feat(parser): add golang support`
- `fix(validate): handle empty namespace`
- `docs: update builder examples`

## Package URLs (PURLs)

**Format**: `pkg:<type>/<namespace>/<name>@<version>?<qualifiers>#<subpath>`

**Examples**:
```
pkg:npm/lodash@4.17.21
pkg:npm/@babel/core@7.20.0
pkg:pypi/requests@2.28.1
pkg:maven/org.springframework/spring-core@5.3.21
```

**Supported ecosystems**: npm, pypi, maven, gem, cargo, nuget, composer, golang, docker, and [15+ more](../src/purl-type.ts)

## Code Style

**Key patterns** (see [CLAUDE.md](../CLAUDE.md) for full standards):

| Rule | Example |
|------|---------|
| No semicolons | `const x = 5` ✓ |
| Type imports separate | `import type { Foo } from './types.js'` ✓ |
| Node imports with prefix | `import fs from 'node:fs'` ✓ |
| No `process.chdir()` | Use `{ cwd }` options ✓ |
| Bracket notation for index signatures | `obj['prop']` ✓ |

**Error message format**:
- **Parser errors (PurlError)**: No period, lowercase
  - ✓ `throw new PurlError('missing required "name" component')`
- **Arg validation (Error)**: Period, sentence case
  - ✓ `throw new Error('JSON string argument is required.')`

## Testing

**Test organization**:

| File | Purpose |
|------|---------|
| `purl-spec.test.mts` | Spec compliance tests |
| `purl-edge-cases.test.mts` | Edge cases & coverage |
| `package-url.test.mts` | Core class tests |
| `package-url-builder.test.mts` | Builder pattern tests |

**Run tests**:
```bash
pnpm test                        # All tests
pnpm test purl-spec.test.mts    # Specific file
pnpm cover                       # With coverage
```

**⚠ Never use `pnpm test -- <file>`** - runs ALL tests regardless of file argument

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Build fails | `pnpm run clean && pnpm build` |
| Coverage < 100% | `pnpm cover` to see uncovered lines |
| Type errors | `pnpm run type` for details |
| NPM data outdated | `pnpm run update:data:npm` |

## Next Steps

### Essential Reading

1. **[CLAUDE.md](../CLAUDE.md)** - Project standards (MANDATORY)
2. **[Usage Examples](./usage-examples.md)** - Real-world patterns & builder guide
3. **[API Reference](./api-reference.md)** - Complete API documentation

### Deep Dives

**Adding package type support**:

1. Add type to `src/purl-type.ts`:
   ```typescript
   export const PURL_Type = Object.freeze({
     NEWTYPE: 'newtype',
     // ...existing types
   } as const)
   ```

2. Add validation in `src/validate.ts`
3. Add normalization in `src/normalize.ts`
4. Add builder method in `src/package-url-builder.ts`
5. Write comprehensive tests
6. Update documentation

**Result type pattern**:
```typescript
import { Result, Ok, Err } from './result.js'

function parse(input: string): Result<PackageURL> {
  if (!input) return Err(new PurlError('input required'))
  return Ok(purl)
}

if (result.ok) {
  console.log(result.value)  // Type-safe
}
```

**URL conversion**:
```typescript
import { UrlConverter } from '@socketregistry/packageurl-js'

const repo = UrlConverter.toRepositoryUrl(purl)
// → { type: 'git', url: 'https://github.com/...' }

const download = UrlConverter.toDownloadUrl(purl)
// → { type: 'tarball', url: 'https://registry.npmjs.org/...' }
```

## Community

- Follow [@SocketSecurity](https://twitter.com/SocketSecurity) on Twitter
- Follow [@socket.dev](https://bsky.app/profile/socket.dev) on Bluesky
- Report issues on [GitHub](https://github.com/SocketDev/socket-packageurl-js/issues)

---

**Performance tip**: Use `pnpm build --watch` during development for 68% faster incremental builds (9ms vs 27ms)
