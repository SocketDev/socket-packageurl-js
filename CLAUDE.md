# CLAUDE.md

🚨 **MANDATORY**: Act as principal-level engineer with deep expertise in JavaScript, Node.js, and package URL parsing.

## 📚 SHARED STANDARDS

**See canonical reference:** `../socket-registry/CLAUDE.md`

For all shared Socket standards (git workflow, testing, code style, imports, sorting, error handling, cross-platform, CI, etc.), refer to socket-registry/CLAUDE.md.

**Git Workflow Reminder**: When user says "commit changes" → create actual commits, use small atomic commits, follow all CLAUDE.md rules (NO AI attribution).

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
- **Build**: `pnpm build`
- **Test**: `pnpm test`, `pnpm test:unit`
- **Type check**: `pnpm check:tsc`
- **Lint**: `pnpm check:lint`
- **Check all**: `pnpm check`
- **Fix**: `pnpm check:lint:fix` or `pnpm fix`
- **Coverage**: `pnpm cover`

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
- **🚨 NEVER USE `--` before test paths** - runs ALL tests
- **Test single file**: ✅ `pnpm test:unit path/to/file.test.js`
- **Update snapshots**: `pnpm test:unit -u` or `pnpm testu`

### CI Testing
- **🚨 MANDATORY**: `SocketDev/socket-registry/.github/workflows/ci.yml@<SHA>` with full SHA
- **Format**: `@662bbcab1b7533e24ba8e3446cffd8a7e5f7617e # main`
- **Docs**: `socket-registry/CLAUDE.md`, `socket-registry/docs/CI_TESTING_TOOLS.md`

### Debugging
- Use benchmarks to verify parsing speed
- Test against purl-spec test suite
- Test unusual but valid package URLs
