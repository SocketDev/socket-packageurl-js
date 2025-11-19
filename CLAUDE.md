# CLAUDE.md

**MANDATORY**: Act as principal-level engineer. Follow these guidelines exactly.

## CANONICAL REFERENCE

This is a reference to shared Socket standards. See `../socket-registry/CLAUDE.md` for canonical source.

## 👤 USER CONTEXT

- **Identify users by git credentials**: Extract name from git commit author, GitHub account, or context
- 🚨 **When identity is verified**: ALWAYS use their actual name - NEVER use "the user" or "user"
- **Direct communication**: Use "you/your" when speaking directly to the verified user
- **Discussing their work**: Use their actual name when referencing their commits/contributions
- **Example**: If git shows "John-David Dalton <jdalton@example.com>", refer to them as "John-David"
- **Other contributors**: Use their actual names from commit history/context

## PRE-ACTION PROTOCOL

**MANDATORY**: Review CLAUDE.md before any action. No exceptions.

## VERIFICATION PROTOCOL

**MANDATORY**: Before claiming any task is complete:
1. Test the solution end-to-end
2. Verify all changes work as expected
3. Run the actual commands to confirm functionality
4. Never claim "Done" without verification

## ABSOLUTE RULES

- Never create files unless necessary
- Always prefer editing existing files
- Forbidden to create docs unless requested
- Required to do exactly what was asked

## ROLE

Principal Software Engineer: production code, architecture, reliability, ownership.

## EVOLUTION

If user repeats instruction 2+ times, ask: "Should I add this to CLAUDE.md?"

## 📚 SHARED STANDARDS

**Canonical reference**: `../socket-registry/CLAUDE.md`

All shared standards (git, testing, code style, cross-platform, CI) defined in socket-registry/CLAUDE.md.

**Quick references**:
- Commits: [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) `<type>(<scope>): <description>` - NO AI attribution
- Scripts: Prefer `pnpm run foo --flag` over `foo:bar` scripts
- Docs: Use `docs/` folder, lowercase-with-hyphens.md filenames, pithy writing with visuals
- Dependencies: After `package.json` edits, run `pnpm install` to update `pnpm-lock.yaml`
- Backward Compatibility: NO backward compat - we're our only consumers, make clean breaks
- Work Safeguards: MANDATORY commit + backup branch before bulk changes
- Safe Deletion: Use `safeDelete()` from `@socketsecurity/lib/fs` (NEVER `fs.rm/rmSync` or `rm -rf`)

---

## 📝 EMOJI & OUTPUT STYLE

**Terminal Symbols** (based on `@socketsecurity/lib/logger` LOG_SYMBOLS):
- ✓ Success/checkmark - MUST be green (NOT ✅)
- ✗ Error/failure - MUST be red (NOT ❌)
- ⚠ Warning/caution - MUST be yellow (NOT ⚠️)
- ℹ Info - MUST be blue (NOT ℹ️)
- → Step/progress - MUST be cyan (NOT ➜ or ▶)

**Color Requirements** (apply color to icon ONLY, not entire message):
```javascript
import colors from 'yoctocolors-cjs'

`${colors.green('✓')} ${msg}`   // Success
`${colors.red('✗')} ${msg}`     // Error
`${colors.yellow('⚠')} ${msg}`  // Warning
`${colors.blue('ℹ')} ${msg}`    // Info
`${colors.cyan('→')} ${msg}`    // Step/Progress
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
- Prefer colored text-based symbols (✓✗⚠ℹ→) for maximum terminal compatibility
- Always color-code symbols: green=success, red=error, yellow=warning, blue=info, cyan=step
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
- **Test**: `pnpm test`
- **Type check**: `pnpm type`
- **Lint**: `pnpm lint`
- **Check all**: `pnpm check`
- **Fix**: `pnpm fix`
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

#### Working Directory
- **🚨 NEVER use `process.chdir()`** - use `{ cwd }` options and absolute paths instead
  - Breaks tests, worker threads, and causes race conditions
  - Always pass `{ cwd: absolutePath }` to spawn/exec/fs operations

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

**Vitest Configuration**: This repo uses the shared vitest configuration patterns documented in `../socket-registry/CLAUDE.md` (see "Vitest Configuration Variants" section). Two configs available:
- `.config/vitest.config.mts` - Main config (threads, isolate: false, concurrent: true)
- `.config/vitest.config.isolated.mts` - Full process isolation (forks, isolate: true)

#### Test File Naming Conventions
🚨 **MANDATORY** - Use correct suffix based on isolation requirements:

**Standard tests** (`*.test.mts`):
- Run with thread pool, shared worker context
- Fast execution, parallel within suites
- Most tests should use this pattern
- Example: `test/package-url.test.mts`

**Isolated tests** (`*.isolated.test.mts`):
- Run with fork pool, full process isolation
- Required for tests that:
  - Mock global objects (global.URL, global.process, etc.)
  - Use vi.doMock() for dynamic module mocking
  - Would cause race conditions in concurrent execution
- Automatically detected and run separately by `scripts/test.mjs`
- Example: `test/purl-global-mocking.isolated.test.mts`

**When to use isolated tests**:
- ✅ Modifying global.URL, global.process, or other globals
- ✅ Tests that fail intermittently in concurrent mode
- ❌ Standard property testing - use regular tests
- ❌ HTTP mocking with nock - works fine in thread pool

#### Test Structure
- **Test files**: `test/` - All test files
- **Spec compliance**: `test/purl-spec.test.mts` - Package URL spec tests
- **Edge cases**: `test/purl-edge-cases.test.mts` - Edge cases and coverage
- **Test helpers**: `test/utils/test-helpers.mts` - Reusable test utilities
- **Assertion helpers**: `test/utils/assertions.mts` - Property validation helpers

#### Test Helpers

Test helpers in `test/utils/test-helpers.mts`:
- `createTestPurl(type, name, opts?)` - Factory for PackageURL instances
- `createTestFunction(returnValue?)` - Creates test functions with optional return values

See file for usage examples.

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
