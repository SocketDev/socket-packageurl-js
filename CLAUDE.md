# CLAUDE.md

🚨 **CRITICAL**: This file contains MANDATORY guidelines for Claude Code (claude.ai/code). You MUST follow these guidelines EXACTLY as specified. Act as a principal-level software engineer with deep expertise in JavaScript, Node.js, and package URL parsing.

## 📚 SHARED STANDARDS

**This project follows Socket's unified development standards.** For comprehensive guidelines on:
- Code style (imports, sorting, __proto__ patterns, comments)
- Git workflow (GitHub Actions, CI, commit messages)
- Error handling standards and message patterns
- Cross-platform compatibility
- Testing best practices (Vitest memory optimization)
- Dependency alignment
- Changelog management

**See the canonical reference:** `socket-registry/CLAUDE.md` (in sibling repository)

This file contains **Package URL (purl) specific** rules and patterns. When in doubt, consult socket-registry/CLAUDE.md first.

## 🎯 YOUR ROLE

You are a **Principal Software Engineer** responsible for production-quality code, architectural decisions, and system reliability.

## 🔍 PRE-ACTION PROTOCOL

- **🚨 MANDATORY**: Before ANY action, review both this file AND socket-registry/CLAUDE.md
- Check before you act - ensure approach follows established patterns
- No exceptions for code changes, commits, documentation, testing, file operations

## 🛡️ ABSOLUTE RULES

- 🚨 **NEVER** create files unless absolutely necessary
- 🚨 **ALWAYS** prefer editing existing files
- 🚨 **FORBIDDEN** to proactively create documentation files unless explicitly requested
- 🚨 **REQUIRED** to do exactly what was asked - nothing more, nothing less

## 🏗️ ARCHITECTURE

### TypeScript Implementation of Package URL Specification
Parsing and constructing package URLs, compiled to CommonJS for deployment.

### Core Structure
- **Main entry**: `src/package-url.ts` - Main exports and API
- **Parser**: Core parsing logic for purl strings
- **Normalizer**: Normalization logic for different package types
- **Validator**: Input validation and sanitization
- **Types**: Type-specific handling for npm, pypi, maven, etc.
- **Build output**: `dist/` - CommonJS compilation output

### Key Features
- Full purl specification compliance
- High-performance parsing with TypeScript type safety
- Type-specific normalization
- Comprehensive validation
- Extensive test coverage
- CommonJS-only deployment for maximum compatibility

## ⚡ COMMANDS

### Development Commands
- **Build**: `pnpm build`
- **Test**: `pnpm test`
- **Test unit**: `pnpm test:unit`
- **Type check**: `pnpm check:tsc`
- **Lint**: `pnpm check:lint`
- **Check all**: `pnpm check`
- **Fix linting**: `pnpm check:lint:fix` or `pnpm fix`
- **Coverage**: `pnpm coverage`

### Testing Best Practices
- **🚨 NEVER USE `--` BEFORE TEST FILE PATHS** - Runs ALL tests!
- **Test single file**: ✅ CORRECT: `pnpm test:unit path/to/file.test.js`
  - ❌ WRONG: `pnpm test:unit -- path/to/file.test.js`
- **Update snapshots**: `pnpm test:unit -u` or `pnpm testu`

## 📋 PURL-SPECIFIC RULES

### 1. Package URL Standards
- Implements [Package URL specification](https://github.com/package-url/purl-spec)
- Maintain strict compliance with purl spec
- Test against reference implementations
- Document any deviations or extensions

### 2. Performance Critical
- High-performance parser used in security scanning
- Optimize for speed without sacrificing correctness
- Benchmark changes against existing performance
- Avoid unnecessary allocations

### 3. Error Handling - PurlError Patterns

#### Error Types
- **Custom error type**: Use `PurlError` from `src/error.js` for parser-specific errors
- **Standard errors**: Use `Error` only for generic argument validation
- **Catch parameters**: 🚨 MANDATORY - Use `catch (e)` not `catch (error)`

#### Error Message Format
- **Parser errors (PurlError)**: No ending period, lowercase start (unless proper noun)
  - ✅ CORRECT: `throw new PurlError('missing required "pkg" scheme component')`
  - ✅ CORRECT: `throw new PurlError('npm "name" component cannot contain whitespace')`
  - ❌ WRONG: `throw new PurlError('Missing required component.')`
- **Argument validation (Error)**: Ending period, sentence case
  - ✅ CORRECT: `throw new Error('JSON string argument is required.')`
  - ✅ CORRECT: `throw new Error('Invalid JSON string.', { cause: e })`
  - ❌ WRONG: `throw new Error('json string required')`

#### Error Message Patterns
- **Component validation**: `{type} "{component}" component {violation}`
  - Example: `cocoapods "name" component cannot contain whitespace`
- **Required components**: `"{component}" is a required component`
- **Type-specific requirements**: `{type} requires a "{component}" component`
- **Qualifier validation**: `qualifier "{key}" {violation}`
  - Example: `qualifier "tag_id" must not be empty`
- **Parse failures**: `failed to parse as {format}` or `unable to decode "{component}" component`
- **Character restrictions**: Use specific descriptions like `cannot start with`, `cannot contain`

#### Error Handling Requirements
- **Spec compliance**: Never throw on valid purls per spec
- **Error context**: Include `{ cause: e }` when wrapping underlying errors
- **No process.exit()**: Never use `process.exit(1)` - throw errors instead
- **No silent failures**: Never use `logger.error()` followed by `return` - throw proper errors

## 🎨 PURL-SPECIFIC CODE PATTERNS

### File Structure
- **File extensions**: `.ts` for TypeScript, `.js` for JavaScript, `.mjs` for ES modules
- **Naming**: kebab-case (e.g., `package-url.ts`, `purl-type.ts`)
- **Module headers**: 🚨 MANDATORY - All modules MUST have `@fileoverview` headers

### TypeScript Patterns
- **Optional properties**: With `exactOptionalPropertyTypes`, assign conditionally
  - ✅ CORRECT: `if (value !== undefined) { this.prop = value }`
  - ❌ WRONG: `this.prop = value ?? undefined`

### Index Signatures & Bracket Notation
- **Access pattern**: 🚨 MANDATORY - Use bracket notation with index signatures
  - ✅ CORRECT: `obj['prop']?.['method']`
  - ❌ WRONG: `obj.prop.method`
- **Type assertions**: Use with bracket notation
  - ✅ CORRECT: `(obj['method'] as MethodType)?.(arg)`
- **Reusable types**: Define common patterns once
  - `ComponentEncoder = (_value: unknown) => string`
  - `ComponentNormalizer = (_value: string) => string | undefined`
  - `QualifiersValue = string | number | boolean | null | undefined`

## 🔧 GIT WORKFLOW

### Commit Messages
- **🚨 ABSOLUTELY FORBIDDEN**: NEVER add Claude Code attribution to commit messages
  - ❌ WRONG: Adding "🤖 Generated with [Claude Code]..." or "Co-Authored-By: Claude"
  - ✅ CORRECT: Write commit messages without any AI attribution or signatures
  - **Rationale**: This is a professional project and commit messages should not contain AI tool attributions

### Pre-Commit Quality Checks
- **🚨 MANDATORY**: Always run these commands before committing:
  - `pnpm fix` - Fix linting and formatting issues
  - `pnpm check` - Run all checks (lint, type-check, tests)
  - **Rationale**: Ensures code quality regardless of whether hooks run

### Commit Strategy with --no-verify
- **--no-verify usage**: Use `--no-verify` flag for commits that don't require pre-commit hooks
  - ✅ **Safe to skip hooks**: GitHub Actions workflows (.github/workflows/), tests (test/), documentation (*.md), configuration files
  - ❌ **Always run hooks**: Package source code (src/), published library code, parser implementations
  - **Important**: Even when using `--no-verify`, you MUST still run `pnpm fix` and `pnpm check` manually first
  - **Rationale**: Pre-commit hooks run linting and type-checking which are critical for library code but less critical for non-published files

## 🔍 DEBUGGING

### Performance Testing
- Use benchmarks to verify parsing speed
- Test against purl-spec test suite
- Test with unusual but valid package URLs

---

**For all other standards not covered here, refer to `socket-registry/CLAUDE.md` (in sibling repository)**
