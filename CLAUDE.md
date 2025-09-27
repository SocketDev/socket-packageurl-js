# CLAUDE.md

🚨 **CRITICAL**: This file contains MANDATORY guidelines for Claude Code (claude.ai/code). You MUST follow these guidelines EXACTLY as specified. Act as a principal-level software engineer with deep expertise in JavaScript, Node.js, and package URL parsing.

## 📝 CLAUDE.MD EVOLUTION

### Pattern Recognition & Documentation
- **🚨 MANDATORY**: If the user repeatedly tells you to change or do something in multiple conversations, ask if it should be added to CLAUDE.md
- **Examples of candidates**: Repeated code style corrections, consistent testing patterns, frequent workflow changes, recurring error fixes
- **Question format**: "I notice you've mentioned [pattern] multiple times. Should I add this as a guideline to CLAUDE.md for consistency across projects?"
- **Update trigger**: If the same instruction comes up 2+ times in different contexts, proactively suggest adding it to documentation

## 📚 Learning & Knowledge Sharing

### Self-Learning Protocol
Claude Code should periodically scan and learn from CLAUDE.md files across Socket repositories:
- `socket-cli/CLAUDE.md`
- `socket-packageurl-js/CLAUDE.md`
- `socket-registry/CLAUDE.md`
- `socket-sdk-js/CLAUDE.md`
- `socket-workflows/CLAUDE.md`

When working in any Socket repository, check for updates and patterns in other claude.md files to ensure consistency across the ecosystem.

### Cross-Project Learning
- When discovering generally applicable patterns or guidelines, update CLAUDE.md files in other socket- projects
- Examples: c8 comment formatting, error handling patterns, code style rules, test organization patterns, workflow patterns
- This ensures consistency across the Socket ecosystem

### Recent Learnings Applied
- **Test Organization**: Modular test files improve maintainability across all projects
- **TypeScript Index Signatures**: Enhanced patterns for bracket notation access and type assertions
- **Error Message Consistency**: Use consistent error message patterns across all Socket projects
- **TypeScript Strict Mode**: All projects should use strict TypeScript configuration
- **Import Organization**: Separate type imports from runtime imports for better tree-shaking
- **Safe File Removal**: Use appropriate file removal patterns optimized for different environments
- **Cross-Platform Support**: Enhanced cross-platform compatibility measures across all projects

## 🎯 Your Role
You are a **Principal Software Engineer** responsible for:
- Writing production-quality, maintainable code
- Making architectural decisions with long-term impact in mind
- Ensuring code follows established patterns and conventions
- Mentoring through code examples and best practices
- Prioritizing system reliability, performance, and developer experience
- Taking ownership of technical decisions and their consequences

## Commands

### Development Commands
- **Build**: `pnpm build`
- **Test**: `pnpm test` (runs all tests)
- **Test unit**: `pnpm test:unit`
- **Type check**: `pnpm check:tsc`
- **Lint**: `pnpm check:lint`
- **Check all**: `pnpm check` (runs all checks in parallel)
- **Fix linting**: `pnpm check:lint:fix` or `pnpm fix`
- **Coverage**: `pnpm coverage`
- **Coverage percentage**: `pnpm coverage:percent`
- **Clean**: `pnpm clean` (removes cache, coverage, node_modules)

### Testing Best Practices - CRITICAL: NO -- FOR FILE PATHS
- **🚨 NEVER USE `--` BEFORE TEST FILE PATHS** - This runs ALL tests, not just your specified files!
- **Test single file**: ✅ CORRECT: `pnpm test:unit path/to/file.test.js`
  - ❌ WRONG: `pnpm test:unit -- path/to/file.test.js` (runs ALL tests!)
- **Test with pattern**: `pnpm test:unit -t "pattern"`
- **Update snapshots**: `pnpm test:unit -u` or `pnpm testu`
- **Coverage report**: `pnpm test:unit:coverage`

#### Vitest Memory Optimization (CRITICAL)
- **Pool configuration**: Use `pool: 'forks'` with `singleFork: true`, `maxForks: 1`, `isolate: true`
- **Memory limits**: Set `NODE_OPTIONS="--max-old-space-size=4096 --max-semi-space-size=512"` in `.env.test`
- **Timeout settings**: Use `testTimeout: 60000, hookTimeout: 60000` for stability
- **Thread limits**: Use `singleThread: true, maxThreads: 1` to prevent RegExp compiler exhaustion
- **Test cleanup**: 🚨 MANDATORY - Use `await trash([paths])` in test scripts/utilities only. For cleanup within `/src/` test files, use `fs.rm()` with proper error handling

#### Test Organization Best Practices
- **Modular test files**: Split large test files by functionality for better maintainability
- **Descriptive naming**: Use clear, descriptive test file names that reflect what's being tested
- **Test directory structure**: 🚨 MANDATORY - Standardize test directory organization across all Socket projects:
  ```
  test/
  ├── unit/                   # Unit tests
  ├── integration/           # Integration tests (if applicable)
  ├── fixtures/              # Test fixtures and data files
  └── utils/                 # Test utilities and helpers
  ```
- **Test utilities organization**: 🚨 MANDATORY - Organize test utilities in `test/utils/` directory
  - **Directory structure**: Create `test/utils/` subdirectory for reusable test utilities
  - **File naming**: Use descriptive names like `test-utils.mts`, `mock-helpers.mts`, `setup-helpers.mts`
  - **Import paths**: Update all test file imports to reference `./utils/` path
  - **Cross-project consistency**: Apply this pattern across all Socket projects for standardization
  - **Examples**:
    - ✅ CORRECT: `import { setupTestEnvironment } from './utils/test-utils.mts'`
    - ❌ OLD PATTERN: `import { setupTestEnvironment } from './test-utils.mts'`
- **Test fixtures**: Store reusable test data, mock responses, and sample files in `test/fixtures/` directory
  - **Organization**: Group fixtures by test category or functionality
  - **File formats**: Support JSON, text, binary files as needed for comprehensive testing
  - **Naming**: Use descriptive names that clearly indicate the fixture's purpose
- **Proper mocking**: Clean up mocks properly to prevent test interference
- **Error scenarios**: Test both success and error paths for comprehensive coverage
- **Edge cases**: Include tests for unusual but valid inputs and error conditions

### Cross-Platform Compatibility - CRITICAL: Windows and POSIX
- **🚨 MANDATORY**: Tests and functionality MUST work on both POSIX (macOS/Linux) and Windows systems
- **Path handling**: ALWAYS use `path.join()`, `path.resolve()`, `path.sep` for file paths
  - ❌ WRONG: `'/usr/local/bin/npm'` (hard-coded POSIX path)
  - ✅ CORRECT: `path.join(path.sep, 'usr', 'local', 'bin', 'npm')` (cross-platform)
  - ❌ WRONG: `'/project/package-lock.json'` (hard-coded forward slashes)
  - ✅ CORRECT: `path.join('project', 'package-lock.json')` (uses correct separator)
- **Temp directories**: Use `os.tmpdir()` for temporary file paths in tests
  - ❌ WRONG: `'/tmp/test-project'` (POSIX-specific)
  - ✅ CORRECT: `path.join(os.tmpdir(), 'test-project')` (cross-platform)
  - **Unique temp dirs**: Use `fs.mkdtemp()` or `fs.mkdtempSync()` for collision-free directories
  - ✅ PREFERRED: `await fs.mkdtemp(path.join(os.tmpdir(), 'socket-test-'))` (async)
  - ✅ ACCEPTABLE: `fs.mkdtempSync(path.join(os.tmpdir(), 'socket-test-'))` (sync)
- **Path separators**: Never hard-code `/` or `\` in paths
  - Use `path.sep` when you need the separator character
  - Use `path.join()` to construct paths correctly
- **File URLs**: Use `pathToFileURL()` and `fileURLToPath()` from `node:url` when working with file:// URLs
  - ❌ WRONG: `path.dirname(new URL(import.meta.url).pathname)` (Windows path doubling)
  - ✅ CORRECT: `path.dirname(fileURLToPath(import.meta.url))` (cross-platform)
- **Line endings**: Be aware of CRLF (Windows) vs LF (Unix) differences when processing text files
- **Shell commands**: Consider platform differences in shell commands and utilities

### Git Commit Guidelines
- **🚨 FORBIDDEN**: NEVER add Claude co-authorship or Claude signatures to commits
- **🚨 FORBIDDEN**: Do NOT include "Generated with Claude Code" or similar AI attribution in commit messages
- **Commit messages**: Should be written as if by a human developer, focusing on the what and why of changes
- **Professional commits**: Write clear, concise commit messages that describe the actual changes made
- **Commit without tests**: `git commit --no-verify` (skips pre-commit hooks including tests)

### Package Management
- **Package Manager**: This project uses pnpm
- **Install dependencies**: `pnpm install`
- **Add dependency**: `pnpm add <package> --save-exact`
- **Add dev dependency**: `pnpm add -D <package> --save-exact`
- **🚨 MANDATORY**: Always add dependencies with exact versions using `--save-exact` flag to ensure reproducible builds
- **Update dependencies**: `pnpm update`
- **Script execution**: Always use `pnpm run <script>` for package.json scripts to distinguish from built-in pnpm commands
  - ✅ CORRECT: `pnpm run build`, `pnpm run test`, `pnpm run check`
  - ❌ AVOID: `pnpm build`, `pnpm test` (unclear if built-in or script)
- **README installation examples**: 🚨 MANDATORY - All package installation examples in README.md files MUST use `pnpm install` instead of `npm install`
  - ✅ CORRECT: `pnpm install @socketregistry/packageurl-js`
  - ❌ WRONG: `npm install @socketregistry/packageurl-js`
  - **Rationale**: Maintain consistency with project's chosen package manager across all documentation
- **Dynamic imports**: Only use dynamic imports for test mocking (e.g., `vi.importActual` in Vitest). Avoid runtime dynamic imports in production code

## Important Project-Specific Rules

### 1. Package URL (purl) Standards
- This project implements the [Package URL specification](https://github.com/package-url/purl-spec)
- Maintain strict compliance with purl spec
- Test against reference implementations
- Document any deviations or extensions

### 2. Performance Critical
- This is a high-performance parser used in security scanning
- Optimize for speed without sacrificing correctness
- Benchmark changes against existing performance
- Avoid unnecessary allocations

### 3. Testing
- Always run lint and typecheck before committing:
  - `pnpm check:lint`
  - `pnpm check:tsc`
- Run tests with: `pnpm test`
- Test coverage is critical - maintain high coverage

### 4. Git Workflow
- **DO NOT commit automatically** - let the user review changes first
- Use `--no-verify` flag only when explicitly requested
- Always provide clear, descriptive commit messages

### 5. Code Style
- Follow existing patterns in the codebase
- Don't add comments unless specifically requested
- Maintain consistency with surrounding code
- Use existing utilities from @socketsecurity/registry where available

### 6. Error Handling
- Parser errors should be descriptive and actionable
- Validate inputs thoroughly
- Handle edge cases gracefully
- Never throw on valid purls

## Changelog Management

When updating the changelog (`CHANGELOG.md`):
- Version headers should be formatted as markdown links to GitHub releases
- Use the format: `## [version](https://github.com/SocketDev/socket-packageurl-js/releases/tag/vversion) - date`
- Example: `## [1.0.2](https://github.com/SocketDev/socket-packageurl-js/releases/tag/v1.0.2) - 2025-01-15`
- This allows users to click version numbers to view the corresponding GitHub release

### Keep a Changelog Compliance
Follow the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format:
- Use standard sections: Added, Changed, Fixed, Removed (Security if applicable)
- Maintain chronological order with latest version first
- Include release dates in YYYY-MM-DD format
- Make entries human-readable, not machine diffs
- Focus on notable changes that impact users

## Architecture

This is a TypeScript implementation of the Package URL (purl) specification for parsing and constructing package URLs, compiled to CommonJS for deployment.

### Core Structure
- **Main entry**: `src/package-url.ts` - Main exports and API (TypeScript)
- **Parser**: Core parsing logic for purl strings
- **Normalizer**: Normalization logic for different package types
- **Validator**: Input validation and sanitization
- **Types**: Type-specific handling for npm, pypi, maven, etc.
- **Scripts**: `scripts/` - Build and utility scripts
- **Tests**: `test/` - Comprehensive test suite
- **Build output**: `dist/` - CommonJS TypeScript compilation output

### Key Features
- Full purl specification compliance
- High-performance parsing with TypeScript type safety
- Type-specific normalization
- Comprehensive validation
- Extensive test coverage
- CommonJS-only deployment for maximum compatibility

## 🔧 Code Style (MANDATORY)

### 📁 File Organization
- **File extensions**: Use `.ts` for TypeScript files, `.js` for JavaScript files, `.mjs` for ES modules
- **Module headers**: 🚨 MANDATORY - All JavaScript/TypeScript modules MUST have `@fileoverview` headers
  - **Format**: Use `/** @fileoverview Brief description of module purpose. */` at the top of each file
  - **Placement**: Must be the very first content in the file, before imports or other code
  - **Content**: Provide a concise, clear description of what the module does and its primary purpose
  - **Examples**:
    - ✅ CORRECT: `/** @fileoverview Package URL parsing and validation utilities for various ecosystems. */`
    - ✅ CORRECT: `/** @fileoverview Type definitions and interfaces for Package URL specification. */`
    - ❌ FORBIDDEN: Missing @fileoverview header entirely
    - ❌ FORBIDDEN: Placing @fileoverview after imports or other code
- **Import order**: Node.js built-ins first, then third-party packages, then local imports
- **Import grouping**: Group imports by source (Node.js, external packages, local modules)
- **Node.js module imports**: 🚨 MANDATORY - Always use `node:` prefix for Node.js built-in modules
  - ✅ CORRECT: `import { readFile } from 'node:fs'`, `import path from 'node:path'`
  - ❌ FORBIDDEN: `import { readFile } from 'fs'`, `import path from 'path'`
- **Type imports**: 🚨 ALWAYS use separate `import type` statements for TypeScript types, NEVER mix runtime imports with type imports in the same statement
  - ✅ CORRECT: `import { readPackageJson } from '@socketsecurity/registry/lib/packages'` followed by `import type { PackageJson } from '@socketsecurity/registry/lib/packages'`
  - ❌ FORBIDDEN: `import { readPackageJson, type PackageJson } from '@socketsecurity/registry/lib/packages'`

### Naming Conventions
- **Constants**: Use `UPPER_SNAKE_CASE` for constants (e.g., `CMD_NAME`, `REPORT_LEVEL`)
- **Files**: Use kebab-case for filenames (e.g., `package-url.ts`, `purl-type.ts`)
- **Variables**: Use camelCase for variables and functions
- **Classes**: Use PascalCase for classes
- **Types/Interfaces**: Use PascalCase for TypeScript types and interfaces

### 🏗️ Code Structure (CRITICAL PATTERNS)
- **Type definitions**: 🚨 ALWAYS use `import type` for better tree-shaking and TypeScript optimization
- **Error handling**: 🚨 REQUIRED - Use try-catch blocks and handle errors gracefully
- **TypeScript `any` types**: 🚨 FORBIDDEN - Use `any` as absolute last resort only. Prefer `unknown`, specific types, or type assertions. `any` disables type checking and should be avoided
- **Array destructuring**: Use object notation `{ 0: key, 1: data }` instead of array destructuring `[key, data]`
- **Dynamic imports**: 🚨 FORBIDDEN - Never use dynamic imports (`await import()`). Always use static imports at the top of the file
- **Comment formatting**: 🚨 MANDATORY - ALL comments MUST follow these rules:
  - **Single-line preference**: Prefer single-line comments (`//`) over multiline comments (`/* */`) unless for method headers, module headers, or copyright notices. Use single-line comments for property descriptions, inline explanations, and general code comments.
  - **Periods required**: Every comment MUST end with a period, except ESLint disable comments and URLs which are directives/references. This includes single-line, multi-line, inline, and c8 ignore comments.
  - **Sentence structure**: Comments should be complete sentences with proper capitalization and grammar.
  - **Placement**: Place comments on their own line above the code they describe, not trailing to the right of code.
  - **Style**: Use fewer hyphens/dashes and prefer commas, colons, or semicolons for better readability.
  - **Examples**:
    - ✅ CORRECT: `// This function validates user input.` (single-line preferred)
    - ✅ CORRECT: `// Custom GitHub host (default: github.com).` (property description)
    - ✅ CORRECT: `/* This is a method header JSDoc comment. */` (method/module headers only)
    - ✅ CORRECT: `// eslint-disable-next-line no-await-in-loop` (directive, no period)
    - ✅ CORRECT: `// See https://example.com/docs` (URL reference, no period)
    - ✅ CORRECT: `// c8 ignore start - Reason for ignoring.` (explanation has period)
    - ❌ WRONG: `/** Custom GitHub host (default: github.com). */` (multiline for simple property)
    - ❌ WRONG: `// this validates input` (no period, not capitalized)
    - ❌ WRONG: `const x = 5 // some value` (trailing comment)
  - **JSDoc comments**: 🚨 SIMPLIFIED - Only use @throws for error documentation. Avoid @param and @returns tags - function signatures and good function names should be self-documenting.
- **Sorting**: 🚨 MANDATORY - Always sort lists, exports, and items alphabetically for consistency
- **Await in loops**: When using `await` inside for-loops, add `// eslint-disable-next-line no-await-in-loop` when sequential processing is intentional
- **For...of loop type annotations**: 🚨 FORBIDDEN - Never use type annotations in for...of loop variable declarations. TypeScript cannot parse `for await (const chunk: Buffer of stream)` - use `for await (const chunk of stream)` instead and let TypeScript infer the type
- **If statement returns**: Never use single-line return if statements; always use proper block syntax with braces
- **List formatting**: Use `-` for bullet points in text output, not `•` or other Unicode characters
- **Existence checks**: Perform simple existence checks first before complex operations
- **Destructuring order**: Sort destructured properties alphabetically in const declarations
- **Function ordering**: Place functions in alphabetical order, with private functions first, then exported functions
- **Object mappings**: Use objects with `__proto__: null` (not `undefined`) for static string-to-string mappings and lookup tables to prevent prototype pollution; use `Map` for dynamic collections that will be mutated
- **Mapping constants**: Move static mapping objects outside functions as module-level constants with descriptive UPPER_SNAKE_CASE names
- **Array length checks**: Use `!array.length` instead of `array.length === 0`. For `array.length > 0`, use `!!array.length` when function must return boolean, or `array.length` when used in conditional contexts
- **Catch parameter naming**: Use `catch (e)` instead of `catch (error)` for consistency
- **Number formatting**: 🚨 REQUIRED - Use underscore separators (e.g., `20_000`) for large numeric literals. 🚨 FORBIDDEN - Do NOT modify number values inside strings
- **Node.js fs imports**: 🚨 MANDATORY pattern - `import { someSyncThing, promises as fs } from 'node:fs'`
- **Process spawning**: 🚨 FORBIDDEN to use Node.js built-in `child_process.spawn` - MUST use `spawn` from `@socketsecurity/registry/lib/spawn`
- **JSDoc function documentation**: 🚨 MANDATORY - Function JSDoc comments MUST follow this exact pattern:
  - **Format**: Description only, with optional `@throws` - NO `@param` or `@returns` tags
  - **Order**: Description paragraph, then `@throws` tag (if needed)
  - **Closure**: End with `*/` immediately after the last JSDoc tag
  - **Examples**:
    - ✅ CORRECT:
      ```javascript
      /**
       * Check if a string contains a trusted domain using proper URL parsing.
       */
      ```
    - ✅ CORRECT (with throws):
      ```javascript
      /**
       * Parse a configuration file and validate its contents.
       * @throws {Error} When file cannot be read or parsed.
       */
      ```
    - ❌ FORBIDDEN: Adding `@param` or `@returns` tags
    - ❌ FORBIDDEN: Adding extra tags like `@author`, `@since`, `@example`, etc.
    - ❌ FORBIDDEN: Adding empty lines between JSDoc tags
    - ❌ FORBIDDEN: Adding extra content after the last JSDoc tag

### 🗑️ Safe File Operations (SECURITY CRITICAL)
- **Script usage only**: Use `trash` package ONLY in scripts, build files, and utilities - NOT in `/src/` files
- **Import and use `trash` package**: `import { trash } from 'trash'` then `await trash(paths)` (scripts only)
- **Source code deletion**: In `/src/` files, use `fs.rm()` with proper error handling when deletion is required
- **Script deletion operations**: Use `await trash()` for scripts, build processes, and development utilities
- **Array optimization**: `trash` accepts arrays - collect paths and pass as array
- **Async requirement**: Always `await trash()` - it's an async operation
- **NO rmSync**: 🚨 ABSOLUTELY FORBIDDEN - NEVER use `fs.rmSync()` or `rm -rf` commands
- **Examples**:
  - ❌ CATASTROPHIC: `rm -rf directory` (permanent deletion - DATA LOSS RISK)
  - ❌ REPOSITORY DESTROYER: `rm -rf "$(pwd)"` (deletes entire repository)
  - ❌ FORBIDDEN: `fs.rmSync(tmpDir, { recursive: true, force: true })` (dangerous)
  - ✅ SCRIPTS: `await trash([tmpDir])` (recoverable deletion in build scripts)
  - ✅ SOURCE CODE: `await fs.rm(tmpDir, { recursive: true, force: true })` (when needed in /src/)
- **Why scripts use trash**: Enables recovery from accidental deletions during development and build processes
- **Why source avoids trash**: Bundling complications and dependency management issues in production code

### 🔧 Formatting Rules
- **Indentation**: 2 spaces (no tabs)
- **Quotes**: Single quotes for strings preferred
- **Semicolons**: No semicolons preferred
- **Variables**: Use camelCase for variables and functions
- **Linting**: Uses ESLint, Oxlint, and Biome
- **Line length**: Target 80 character line width where practical

### 🏗️ Function Options Pattern (MANDATORY)
- **🚨 REQUIRED**: ALL functions accepting options MUST follow this exact pattern:
  ```typescript
  function foo(a: SomeA, b: SomeB, options?: SomeOptions | undefined): FooResult {
    const opts = { __proto__: null, ...options } as SomeOptions
    // OR for destructuring with defaults:
    const { someOption = 'someDefaultValue' } = { __proto__: null, ...options } as SomeOptions
    // ... rest of function
  }
  ```
- **Key requirements**:
  - Options parameter MUST be optional with `?` and explicitly typed as `| undefined`
  - MUST use `{ __proto__: null, ...options }` pattern to prevent prototype pollution
  - MUST use `as SomeOptions` type assertion after spreading
  - Use destructuring form when you need defaults for individual options
  - Use direct assignment form when passing entire options object to other functions
- **Examples**:
  - ✅ CORRECT: `const opts = { __proto__: null, ...options } as SomeOptions`
  - ✅ CORRECT: `const { timeout = 5000, retries = 3 } = { __proto__: null, ...options } as SomeOptions`
  - ❌ FORBIDDEN: `const opts = { ...options }` (vulnerable to prototype pollution)
  - ❌ FORBIDDEN: `const opts = options || {}` (doesn't handle null prototype)
  - ❌ FORBIDDEN: `const opts = Object.assign({}, options)` (inconsistent pattern)

### 🔧 TypeScript Index Signature Patterns (CRITICAL)
- **Bracket notation access**: 🚨 MANDATORY - When accessing properties from objects with index signatures (created with `Object.create(null)`), use bracket notation to avoid TypeScript errors
- **Optional chaining**: Use optional chaining (`?.`) with bracket notation when the object might be undefined
- **Type assertions**: Use type assertions to help TypeScript understand the types of functions accessed through bracket notation
- **DRY type definitions**: Create reusable type definitions for repeated patterns to improve maintainability
- **Examples**:
  - ✅ CORRECT: `PurlComponent['type']?.['normalize']` (bracket notation with optional chaining)
  - ✅ CORRECT: `(PurlComponent['type']?.['normalize'] as ComponentNormalizer)?.(value)` (with type assertion)
  - ❌ WRONG: `PurlComponent.type.normalize` (dot notation fails with index signatures)
  - ❌ WRONG: `PurlComponent.type?.normalize` (mixed notation)
- **Reusable type patterns**:
  - `ComponentEncoder = (_value: unknown) => string` for encode functions
  - `ComponentNormalizer = (_value: string) => string | undefined` for normalize functions
  - `ComponentValidator = (_value: unknown, _throws: boolean) => boolean` for validate functions
  - `QualifiersValue = string | number | boolean | null | undefined` for individual qualifier values
  - `QualifiersObject = Record<string, QualifiersValue>` for qualifier objects
- **ExactOptionalPropertyTypes handling**: When using TypeScript's `exactOptionalPropertyTypes`, conditionally assign optional properties only when they have values:
  - ✅ CORRECT: `if (value !== undefined) { this.optionalProp = value as string }`
  - ❌ WRONG: `this.optionalProp = value ?? undefined` (fails with exactOptionalPropertyTypes)

### Test Coverage
- All `c8 ignore` comments MUST include a reason why the code is being ignored
- All c8 ignore comments MUST end with periods for consistency
- Format: `// c8 ignore start - Reason for ignoring.`
- Example: `// c8 ignore start - Internal helper functions not exported.`
- This helps maintain clarity about why certain code paths aren't tested

## Debugging and Troubleshooting
- **Performance testing**: Use benchmarks to verify parsing speed
- **Spec compliance**: Test against purl-spec test suite
- **Edge cases**: Test with unusual but valid package URLs

---

# 🚨 CRITICAL BEHAVIORAL REQUIREMENTS

## 🎯 Principal Engineer Mindset
- Act with the authority and expertise of a principal-level software engineer
- Make decisions that prioritize long-term maintainability over short-term convenience
- Anticipate edge cases and potential issues before they occur
- Write code that other senior engineers would be proud to review
- Take ownership of technical decisions and their consequences

## 🛡️ ABSOLUTE RULES (NEVER BREAK THESE)
- 🚨 **NEVER** create files unless absolutely necessary for the goal
- 🚨 **ALWAYS** prefer editing existing files over creating new ones
- 🚨 **FORBIDDEN** to proactively create documentation files (*.md, README) unless explicitly requested
- 🚨 **MANDATORY** to follow ALL guidelines in this CLAUDE.md file without exception
- 🚨 **REQUIRED** to do exactly what was asked - nothing more, nothing less

## 🎯 Quality Standards
- Code MUST pass all existing lints and type checks
- Changes MUST maintain backward compatibility unless explicitly breaking changes are requested
- All patterns MUST follow established codebase conventions
- Error handling MUST be robust and user-friendly
- Performance considerations MUST be evaluated for any changes

## 📋 Recurring Patterns & Instructions

These are patterns and instructions that should be consistently applied across all Socket projects:

### 🏗️ Mandatory Code Patterns
1. **Options Parameter Pattern**: Use `{ __proto__: null, ...options } as SomeOptions` for all functions accepting options
2. **Reflect.apply Pattern**: Use `const { apply: ReflectApply } = Reflect` and `ReflectApply(fn, thisArg, [])` instead of `.call()` for method invocation
3. **Object Mappings**: Use `{ __proto__: null, ...mapping }` for static string-to-string mappings to prevent prototype pollution
4. **Import Separation**: ALWAYS separate type imports (`import type`) from runtime imports
5. **Node.js Imports**: ALWAYS use `node:` prefix for Node.js built-in modules

### 🧪 Test Patterns & Cleanup
1. **Remove Duplicate Tests**: Eliminate tests that verify the same functionality across multiple files
2. **Centralize Test Data**: Use shared test fixtures instead of hardcoded values repeated across projects
3. **Focus Test Scope**: Each project should test its specific functionality, not dependencies' core features

### 🔄 Cross-Project Consistency
These patterns should be enforced across all Socket repositories:
- `socket-cli`
- `socket-packageurl-js`
- `socket-registry`
- `socket-sdk-js`
- `socket-workflows`

When working in any Socket repository, check CLAUDE.md files in other Socket projects for consistency and apply these patterns universally.

## Notes

- This project is critical infrastructure for Socket's package analysis
- Performance is paramount - this code runs millions of times
- Maintain strict purl specification compliance
- Always run lint and typecheck before committing
- Test coverage should remain high