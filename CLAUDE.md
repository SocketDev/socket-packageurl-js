# CLAUDE.md

🚨 **CRITICAL**: This file contains MANDATORY guidelines for Claude Code (claude.ai/code). You MUST follow these guidelines EXACTLY as specified. Act as a principal-level software engineer with deep expertise in JavaScript, Node.js, and package URL parsing.

## 📚 Learning & Knowledge Sharing

### Self-Learning Protocol
Claude Code should periodically scan and learn from CLAUDE.md files across Socket repositories:
- `socket-cli/CLAUDE.md`
- `socket-packageurl-js/CLAUDE.md`
- `socket-registry/CLAUDE.md`
- `socket-sdk-js/CLAUDE.md`

When working in any Socket repository, check for updates and patterns in other claude.md files to ensure consistency across the ecosystem.

### Cross-Project Learning
- When discovering generally applicable patterns or guidelines, update CLAUDE.md files in other socket- projects
- Examples: c8 comment formatting, error handling patterns, code style rules
- This ensures consistency across the Socket ecosystem

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
- **Build output**: `dist/cjs/` - CommonJS TypeScript compilation output

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
- **Import order**: Node.js built-ins first, then third-party packages, then local imports
- **Import grouping**: Group imports by source (Node.js, external packages, local modules)
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
- **Array destructuring**: Use object notation `{ 0: key, 1: data }` instead of array destructuring `[key, data]`
- **Dynamic imports**: 🚨 FORBIDDEN - Never use dynamic imports (`await import()`). Always use static imports at the top of the file
- **Comment formatting**: 🚨 MANDATORY - ALL comments MUST follow these rules:
  - **Periods required**: Every comment MUST end with a period, except ESLint disable comments and URLs which are directives/references. This includes single-line, multi-line, inline, and c8 ignore comments.
  - **Sentence structure**: Comments should be complete sentences with proper capitalization and grammar.
  - **Placement**: Place comments on their own line above the code they describe, not trailing to the right of code.
  - **Style**: Use fewer hyphens/dashes and prefer commas, colons, or semicolons for better readability.
  - **Examples**:
    - ✅ CORRECT: `// This function validates user input.`
    - ✅ CORRECT: `/* This is a multi-line comment that explains the complex logic below. */`
    - ✅ CORRECT: `// eslint-disable-next-line no-await-in-loop` (directive, no period)
    - ✅ CORRECT: `// See https://example.com/docs` (URL reference, no period)
    - ✅ CORRECT: `// c8 ignore start - Reason for ignoring.` (explanation has period)
    - ❌ WRONG: `// this validates input` (no period, not capitalized)
    - ❌ WRONG: `const x = 5 // some value` (trailing comment)
- **Sorting**: 🚨 MANDATORY - Always sort lists, exports, and items alphabetically for consistency
- **Await in loops**: When using `await` inside for-loops, add `// eslint-disable-next-line no-await-in-loop` when sequential processing is intentional
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

## Notes

- This project is critical infrastructure for Socket's package analysis
- Performance is paramount - this code runs millions of times
- Maintain strict purl specification compliance
- Always run lint and typecheck before committing
- Test coverage should remain high