# CLAUDE.md

🚨 **MANDATORY**: Act as principal-level engineer with deep expertise in JavaScript, Node.js, and package URL parsing.

## 📚 SHARED STANDARDS

**See canonical reference:** `../socket-registry/CLAUDE.md`

For all shared Socket standards (git workflow, testing, code style, imports, sorting, error handling, cross-platform, CI, etc.), refer to socket-registry/CLAUDE.md.

**Git Workflow Reminder**: When user says "commit changes" → create actual commits, use small atomic commits, follow all CLAUDE.md rules (NO AI attribution).

---

## 📝 EMOJI & OUTPUT STYLE

**Terminal Symbols** (based on `@socketsecurity/lib/logger` LOG_SYMBOLS):
- ✓ Success/checkmark - MUST be green (NOT ✅)
- ✗ Error/failure - MUST be red (NOT ❌)
- ⚠ Warning/caution - MUST be yellow (NOT ⚠️)
- ℹ Info - MUST be blue (NOT ℹ️)

**Color Requirements** (apply color to icon ONLY, not entire message):
```javascript
import colors from 'yoctocolors-cjs'

`${colors.green('✓')} ${msg}`   // Success
`${colors.red('✗')} ${msg}`     // Error
`${colors.yellow('⚠')} ${msg}`  // Warning
`${colors.blue('ℹ')} ${msg}`    // Info
```

**Color Package**:
- Use `yoctocolors-cjs` (NOT `yoctocolors` ESM package)
- Pinned dev dependency in all Socket projects
- CommonJS compatibility for scripts and tooling

**Allowed Emojis** (use sparingly):
- 📦 Packages
- 💡 Ideas/tips
- 🚀 Launch/deploy/excitement
- 🎉 Major success/celebration

**General Philosophy**:
- Prefer colored text-based symbols (✓✗⚠ℹ) for maximum terminal compatibility
- Always color-code symbols: green=success, red=error, yellow=warning, blue=info
- Use emojis sparingly for emphasis and delight
- Avoid emoji overload - less is more
- When in doubt, use plain text

---

## 🏗️ PURL-SPECIFIC

### Architecture
TypeScript implementation of [Package URL specification](https://github.com/package-url/purl-spec) - Compiled to CommonJS for deployment

**Core Structure**:
- **Main**: `src/package-url.ts` - Main exports and API
- **Parser**: Core parsing logic for purl strings
- **Normalizer**: Type-specific normalization
- **Validator**: Input validation and sanitization
- **Types**: Type-specific handling (npm, pypi, maven, etc.)
- **Build**: `dist/` - CommonJS output

**Features**: Full purl spec compliance, high-performance parsing, TypeScript type safety, type-specific normalization, CommonJS-only deployment

### Commands
- **Build**: `pnpm build` (production build)
- **Watch**: `pnpm build --watch` (dev mode with 68% faster incremental builds)
- **Test**: `pnpm test`, `pnpm test:unit`
- **Type check**: `pnpm check:tsc`
- **Lint**: `pnpm check:lint`
- **Check all**: `pnpm check`
- **Fix**: `pnpm check:lint:fix` or `pnpm fix`
- **Coverage**: `pnpm cover`

**Development tip:** Use `pnpm build --watch` for 68% faster rebuilds (9ms vs 27ms). Incremental builds use esbuild's context API for in-memory caching.

### PURL Standards

#### Specification Compliance
- Maintain strict compliance with purl spec
- Test against reference implementations
- Document any deviations/extensions
- Never throw on valid purls per spec

#### Performance Critical
- High-performance parser for security scanning
- Optimize for speed without sacrificing correctness
- Benchmark changes against existing performance
- Avoid unnecessary allocations

### Error Handling - PurlError Patterns

#### Error Types
- **PurlError**: Parser-specific errors from `src/error.js`
- **Error**: Generic argument validation only
- **Catch parameters**: 🚨 MANDATORY `catch (e)` not `catch (error)`

#### Error Message Format
**Parser errors (PurlError)**: No period, lowercase (unless proper noun)
- ✅ `throw new PurlError('missing required "pkg" scheme component')`
- ✅ `throw new PurlError('npm "name" component cannot contain whitespace')`
- ❌ `throw new PurlError('Missing required component.')`

**Argument validation (Error)**: Period, sentence case
- ✅ `throw new Error('JSON string argument is required.')`
- ✅ `throw new Error('Invalid JSON string.', { cause: e })`
- ❌ `throw new Error('json string required')`

#### Error Message Patterns
- **Component validation**: `{type} "{component}" component {violation}`
  - Example: `cocoapods "name" component cannot contain whitespace`
- **Required**: `"{component}" is a required component`
- **Type requirements**: `{type} requires a "{component}" component`
- **Qualifier**: `qualifier "{key}" {violation}`
  - Example: `qualifier "tag_id" must not be empty`
- **Parse failures**: `failed to parse as {format}` or `unable to decode "{component}" component`
- **Character restrictions**: `cannot start with`, `cannot contain`

#### Error Requirements
- Never throw on valid purls per spec
- Include `{ cause: e }` when wrapping errors
- No `process.exit()` - throw errors
- No silent failures - throw proper errors

### TypeScript Patterns

#### Import Style
🚨 MANDATORY - Type imports must be on separate lines:
- ✅ `import { parseScriptArgs, isQuiet } from './argv.mjs'`
  `import type { ArgParserConfig } from './argv.mjs'`
- ❌ `import { parseScriptArgs, isQuiet, type ArgParserConfig } from './argv.mjs'`

#### Optional Properties
With `exactOptionalPropertyTypes`, assign conditionally:
- ✅ `if (value !== undefined) { this.prop = value }`
- ❌ `this.prop = value ?? undefined`

#### Index Signatures & Bracket Notation
🚨 MANDATORY - Use bracket notation with index signatures:
- ✅ `obj['prop']?.['method']`
- ❌ `obj.prop.method`

**Type assertions**: Use with bracket notation
- ✅ `(obj['method'] as MethodType)?.(arg)`

**Reusable types**: Define common patterns once
- `ComponentEncoder = (_value: unknown) => string`
- `ComponentNormalizer = (_value: string) => string | undefined`
- `QualifiersValue = string | number | boolean | null | undefined`

### Testing

#### Test Structure
- **Test files**: `test/` - All test files
- **Spec compliance**: `test/purl-spec.test.mts` - Package URL spec tests
- **Edge cases**: `test/purl-edge-cases.test.mts` - Edge cases and coverage
- **Test helpers**: `test/utils/test-helpers.mts` - Reusable test utilities

#### Test Helpers (`test/utils/test-helpers.mts`)

**createTestPurl(type, name, opts?)** - Factory for creating PackageURL instances
```typescript
import { createTestPurl } from './utils/test-helpers.mts'

// Before: new PackageURL('npm', undefined, 'lodash', '4.17.21', undefined, undefined)
// After:
const purl = createTestPurl('npm', 'lodash', { version: '4.17.21' })

// With all options:
const purl = createTestPurl('npm', 'lodash', {
  version: '4.17.21',
  namespace: '@scope',
  qualifiers: { arch: 'x64' },
  subpath: 'dist/index.js'
})
```

**createTestFunction(returnValue?)** - Creates test functions with optional return values
```typescript
const testFn = createTestFunction('result')
expect(testFn()).toBe('result')
```

#### Running Tests
- **All tests**: `pnpm test` or `pnpm test:unit`
- **Specific file**: `pnpm test:unit path/to/file.test.js`
- **🚨 NEVER USE `--` before test paths** - runs ALL tests
- **Update snapshots**: `pnpm test:unit -u` or `pnpm testu`
- **Coverage**: `pnpm cover` (must maintain 100%)

#### Best Practices
- **Use createTestPurl()**: Cleaner than `new PackageURL()` with many undefined params
- **Maintain 100% coverage**: All code paths must be tested
- **Spec compliance**: Strict compliance with purl spec required
- **Test edge cases**: Include edge cases in `purl-edge-cases.test.mts`
- **Performance**: Benchmark performance-sensitive changes

### CI Testing
- **🚨 MANDATORY**: `SocketDev/socket-registry/.github/workflows/ci.yml@<SHA>` with full SHA
- **Format**: `@662bbcab1b7533e24ba8e3446cffd8a7e5f7617e # main`
- **Docs**: `socket-registry/CLAUDE.md`, `socket-registry/docs/CI_TESTING_TOOLS.md`

### Debugging
- Use benchmarks to verify parsing speed
- Test against purl-spec test suite
- Test unusual but valid package URLs
