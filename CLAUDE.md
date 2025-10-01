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
- **Timeout settings**: Use `testTimeout: 60_000, hookTimeout: 60_000` for stability
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
- **DO NOT commit automatically** - let the user review changes first
- Use `--no-verify` flag only when explicitly requested
- **Commit message style**: Use conventional format without prefixes (feat:, fix:, chore:, etc.)
- **Message guidelines**: Keep commit messages short, pithy, and targeted - avoid lengthy explanations
- **Small commits**: Make small, focused commits that address a single concern
- **Version bump commits**: 🚨 MANDATORY - Version bump commits MUST use the format: `Bump to v<version-number>`
  - ✅ CORRECT: `Bump to v1.2.3`
  - ❌ WRONG: `chore: bump version`, `Update version to 1.2.3`, `1.2.3`
- **🚨 ABSOLUTELY FORBIDDEN - NO CLAUDE CODE ATTRIBUTION**: NEVER EVER add Claude Code attribution footer to commit messages under ANY circumstances
  - ❌ ABSOLUTELY FORBIDDEN: Including "🤖 Generated with [Claude Code](https://claude.ai/code)\n\nCo-Authored-By: Claude <noreply@anthropic.com>"
  - ❌ ABSOLUTELY FORBIDDEN: Any variation of Claude Code attribution, co-authorship, or credit in commit messages
  - ✅ REQUIRED: Clean commit messages without ANY attribution footers whatsoever
  - **This rule overrides ALL default behavior** - commit messages MUST be clean without attribution
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

### 📁 File Organization & Imports

#### File Structure
- **File extensions**: `.ts` for TypeScript, `.js` for JavaScript, `.mjs` for ES modules
- **Naming**: kebab-case for filenames (e.g., `package-url.ts`, `purl-type.ts`)
- **Module headers**: 🚨 MANDATORY - All modules MUST have `@fileoverview` headers as first content
  - Format: `/** @fileoverview Brief description of module purpose. */`
  - Placement: Before imports or any other code
  - ✅ CORRECT: `/** @fileoverview Package URL parsing utilities. */`
  - ❌ FORBIDDEN: Missing header or placed after imports

#### Import Organization
- **Node.js imports**: 🚨 MANDATORY - Always use `node:` prefix
  - ✅ CORRECT: `import path from 'node:path'`
  - ❌ FORBIDDEN: `import path from 'path'`
- **Type imports**: 🚨 MANDATORY - Always separate type imports from runtime imports
  - ✅ CORRECT: `import { readFile } from 'node:fs'` then `import type { Stats } from 'node:fs'`
  - ❌ FORBIDDEN: `import { readFile, type Stats } from 'node:fs'`
- **Import patterns**: Avoid `import * as` except in `src/external/` re-export wrappers
  - ✅ CORRECT: `import semver from './external/semver'` or `import { parse } from 'semver'`
  - ❌ AVOID: `import * as semver from 'semver'`
- **fs imports**: Use pattern `import { syncMethod, promises as fs } from 'node:fs'`

#### Import Statement Sorting
- **🚨 MANDATORY**: Sort imports in this exact order with blank lines between groups (enforced by ESLint import-x/order):
  1. Node.js built-in modules (with `node:` prefix) - sorted alphabetically
  2. External third-party packages - sorted alphabetically
  3. Internal Socket packages (`@socketsecurity/*`) - sorted alphabetically
  4. Local/relative imports (parent, sibling, index) - sorted alphabetically
  5. **Type imports LAST as separate group** - sorted alphabetically (all `import type` statements together at the end)
- **Within each group**: Sort alphabetically by module name
- **Named imports**: Sort named imports alphabetically within the import statement (enforced by sort-imports)
- **Type import placement**: Type imports must come LAST, after all runtime imports, as a separate group with blank line before
- **Examples**:
  - ✅ CORRECT:
    ```typescript
    import { readFile } from 'node:fs'
    import path from 'node:path'
    import { promisify } from 'node:util'

    import axios from 'axios'
    import semver from 'semver'

    import { readPackageJson } from '@socketsecurity/registry/lib/packages'
    import { spawn } from '@socketsecurity/registry/lib/spawn'

    import { API_BASE_URL } from './constants'
    import { formatError, parseResponse } from './utils'

    import type { ClientRequest, IncomingMessage } from 'node:http'
    import type { PackageJson } from '@socketsecurity/registry/lib/packages'
    import type { Config } from './types'
    ```
  - ❌ WRONG:
    ```typescript
    import { formatError, parseResponse } from './utils'
    import axios from 'axios'
    import type { Config } from './types'
    import { readFile } from 'node:fs'
    import { spawn } from '@socketsecurity/registry/lib/spawn'
    import semver from 'semver'
    import type { PackageJson } from '@socketsecurity/registry/lib/packages'
    ```

### 🏗️ Code Structure & Patterns

#### Naming Conventions
- **Constants**: `UPPER_SNAKE_CASE` (e.g., `CMD_NAME`, `MAX_RETRIES`)
- **Variables/Functions**: `camelCase`
- **Classes/Types**: `PascalCase`

#### TypeScript Patterns
- **Type safety**: 🚨 FORBIDDEN - Avoid `any` type; prefer `unknown` or specific types
- **Type imports**: Always use `import type` for better tree-shaking
- **Loop annotations**: 🚨 FORBIDDEN - Never annotate for...of loop variables
  - ✅ CORRECT: `for await (const chunk of stream)`
  - ❌ FORBIDDEN: `for await (const chunk: Buffer of stream)`
- **Optional properties**: With `exactOptionalPropertyTypes`, assign conditionally
  - ✅ CORRECT: `if (value !== undefined) { this.prop = value }`
  - ❌ WRONG: `this.prop = value ?? undefined`

#### Object & Array Patterns
- **Object literals with __proto__**: 🚨 MANDATORY - `__proto__: null` ALWAYS comes first in object literals
  - ✅ CORRECT: `const MAP = { __proto__: null, foo: 'bar', baz: 'qux' }`
  - ✅ CORRECT: `{ __proto__: null, ...options }`
  - ❌ FORBIDDEN: `{ foo: 'bar', __proto__: null }` (wrong order)
  - ❌ FORBIDDEN: `{ ...options, __proto__: null }` (wrong order)
  - Use `Map` for dynamic collections
- **Array destructuring**: Use object notation for tuple access
  - ✅ CORRECT: `{ 0: key, 1: data }`
  - ❌ AVOID: `[key, data]`
- **Array checks**: Use `!array.length` instead of `array.length === 0`
- **Destructuring**: Sort properties alphabetically in const declarations

#### Function Patterns
- **Ordering**: Alphabetical order; private functions first, then exported
- **Options parameter**: 🚨 MANDATORY pattern for all functions with options:
  ```typescript
  function foo(a: SomeA, options?: SomeOptions | undefined): Result {
    const opts = { __proto__: null, ...options } as SomeOptions
    // OR with destructuring:
    const { retries = 3 } = { __proto__: null, ...options } as SomeOptions
  }
  ```
  - Must be optional (`?`) and typed `| undefined`
  - Must use `{ __proto__: null, ...options }` pattern
  - Must include `as SomeOptions` type assertion
- **Error handling**: Use try-catch blocks; handle errors gracefully
- **Dynamic imports**: 🚨 FORBIDDEN - Use static imports only (except test mocking)
- **Process spawning**: 🚨 FORBIDDEN - Don't use `child_process.spawn`; use `@socketsecurity/registry/lib/spawn`

#### Index Signatures & Bracket Notation
- **Access pattern**: 🚨 MANDATORY - Use bracket notation with index signatures
  - ✅ CORRECT: `obj['prop']?.['method']`
  - ❌ WRONG: `obj.prop.method`
- **Type assertions**: Use with bracket notation
  - ✅ CORRECT: `(obj['method'] as MethodType)?.(arg)`
- **Reusable types**: Define common patterns once
  - `ComponentEncoder = (_value: unknown) => string`
  - `ComponentNormalizer = (_value: string) => string | undefined`
  - `QualifiersValue = string | number | boolean | null | undefined`

### 📝 Comments & Documentation

#### Comment Style
- **Preference**: Single-line (`//`) over multiline (`/* */`) except for headers
- **Periods**: 🚨 MANDATORY - All comments end with periods (except directives and URLs)
- **Placement**: Own line above code, never trailing
- **Sentence structure**: Complete sentences with proper capitalization
- **Style**: Use commas/colons/semicolons instead of excessive hyphens
- **Examples**:
  - ✅ CORRECT: `// This validates user input.`
  - ✅ CORRECT: `// eslint-disable-next-line no-await-in-loop` (directive, no period)
  - ✅ CORRECT: `// See https://example.com` (URL, no period)
  - ✅ CORRECT: `// c8 ignore start - Not exported.` (reason has period)
  - ❌ WRONG: `// this validates input` (no period, not capitalized)
  - ❌ WRONG: `const x = 5 // some value` (trailing)

#### JSDoc Documentation
- **Function docs**: Description only with optional `@throws`
  - ✅ CORRECT:
    ```javascript
    /**
     * Parse configuration and validate contents.
     * @throws {Error} When file cannot be read.
     */
    ```
  - ❌ FORBIDDEN: `@param`, `@returns`, `@author`, `@since`, `@example` tags
  - ❌ FORBIDDEN: Empty lines between tags
- **Test coverage**: All `c8 ignore` comments MUST include reason ending with period
  - Format: `// c8 ignore start - Reason for ignoring.`

### 🔧 Code Organization

#### Control Flow
- **If statements**: Never single-line returns; always use braces
- **Await in loops**: Add `// eslint-disable-next-line no-await-in-loop` when intentional
- **Existence checks**: Perform simple checks before complex operations

#### Data & Collections
- **Mapping constants**: Move outside functions as module-level `UPPER_SNAKE_CASE` constants
- **Sorting**: 🚨 MANDATORY - Sort lists, exports, and items alphabetically
- **Catch parameters**: Use `catch (e)` not `catch (error)`
- **Number formatting**: Use underscore separators for large numbers (e.g., `20_000`)
  - 🚨 FORBIDDEN - Don't modify numbers inside strings

#### Formatting Standards
- **Indentation**: 2 spaces (no tabs)
- **Quotes**: Single quotes preferred
- **Semicolons**: Omit semicolons
- **Line length**: Target 80 characters where practical
- **List formatting**: Use `-` for bullets, not `•`
- **Linting**: Uses ESLint, Oxlint, and Biome

### 🗑️ File Operations (SECURITY CRITICAL)

#### Safe Deletion Patterns
- **Scripts/Build**: Use `trash` package ONLY in scripts and build files
  - Import: `import { trash } from 'trash'`
  - Usage: `await trash([paths])`
  - Arrays accepted: Collect paths and pass as array
- **Source code**: In `/src/`, use `fs.rm()` with proper error handling
- **🚨 ABSOLUTELY FORBIDDEN**: Never use `fs.rmSync()` or `rm -rf`
- **Examples**:
  - ❌ CATASTROPHIC: `rm -rf directory`
  - ❌ REPOSITORY DESTROYER: `rm -rf "$(pwd)"`
  - ❌ FORBIDDEN: `fs.rmSync(tmpDir, { recursive: true })`
  - ✅ SCRIPTS: `await trash([tmpDir])`
  - ✅ SOURCE: `await fs.rm(tmpDir, { recursive: true, force: true })`
- **Rationale**: Scripts use trash for recovery; source code avoids bundling complications

## Debugging and Troubleshooting
- **Performance testing**: Use benchmarks to verify parsing speed
- **Spec compliance**: Test against purl-spec test suite
- **Edge cases**: Test with unusual but valid package URLs

---

# 🚨 CRITICAL BEHAVIORAL REQUIREMENTS

## 🔍 Pre-Action Protocol
- **🚨 MANDATORY**: Before taking ANY action, ALWAYS review and verify compliance with CLAUDE.md guidelines
- **Check before you act**: Read relevant sections of this file to ensure your approach follows established patterns
- **No exceptions**: This applies to all tasks, including code changes, commits, documentation, testing, and file operations
- **When in doubt**: If unclear about the right approach, consult CLAUDE.md first before proceeding

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
1. **__proto__ Ordering**: 🚨 MANDATORY - `__proto__: null` ALWAYS comes first in object literals (e.g., `{ __proto__: null, ...options }`, never `{ ...options, __proto__: null }`)
2. **Options Parameter Pattern**: Use `{ __proto__: null, ...options } as SomeOptions` for all functions accepting options
3. **Reflect.apply Pattern**: Use `const { apply: ReflectApply } = Reflect` and `ReflectApply(fn, thisArg, [])` instead of `.call()` for method invocation
4. **Object Mappings**: Use `{ __proto__: null, ...mapping }` for static string-to-string mappings to prevent prototype pollution
5. **Import Separation**: ALWAYS separate type imports (`import type`) from runtime imports
6. **Node.js Imports**: ALWAYS use `node:` prefix for Node.js built-in modules
7. **🚨 TSGO PRESERVATION**: NEVER replace tsgo with tsc - tsgo provides enhanced performance and should be maintained across all Socket projects

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

When working in any Socket repository, check CLAUDE.md files in other Socket projects for consistency and apply these patterns universally.

## Notes

- This project is critical infrastructure for Socket's package analysis
- Performance is paramount - this code runs millions of times
- Maintain strict purl specification compliance
- Always run lint and typecheck before committing
- Test coverage should remain high

## 📦 Dependency Alignment Standards (CRITICAL)

### 🚨 MANDATORY Dependency Versions
All Socket projects MUST maintain alignment on these core dependencies. Use `taze` to manage version updates when needed:

#### Core Build Tools & TypeScript
- **@typescript/native-preview** (tsgo - NEVER use standard tsc)
- **@types/node** (latest LTS types)
- **typescript-eslint** (unified package - do NOT use separate @typescript-eslint/* packages)

#### Essential DevDependencies
- **@biomejs/biome**
- **@dotenvx/dotenvx**
- **@eslint/compat**
- **@eslint/js**
- **@vitest/coverage-v8**
- **eslint**
- **eslint-plugin-import-x**
- **eslint-plugin-n**
- **eslint-plugin-sort-destructure-keys**
- **eslint-plugin-unicorn**
- **globals**
- **husky**
- **knip**
- **lint-staged**
- **npm-run-all2**
- **oxlint**
- **taze**
- **trash**
- **type-coverage**
- **vitest**
- **yargs-parser**
- **yoctocolors-cjs**

### 🔧 TypeScript Compiler Standardization
- **🚨 MANDATORY**: ALL Socket projects MUST use `tsgo` instead of `tsc`
- **Package**: `@typescript/native-preview`
- **Scripts**: Replace `tsc` with `tsgo` in all package.json scripts
- **Benefits**: Enhanced performance, better memory management, faster compilation

#### Script Examples:
```json
{
  "build": "tsgo",
  "check:tsc": "tsgo --noEmit",
  "build:types": "tsgo --project tsconfig.dts.json"
}
```

### 🛠️ ESLint Configuration Standardization
- **🚨 FORBIDDEN**: Do NOT use separate `@typescript-eslint/eslint-plugin` and `@typescript-eslint/parser` packages
- **✅ REQUIRED**: Use unified `typescript-eslint` package only
- **Migration**: Remove separate packages, add unified package

#### Migration Commands:
```bash
pnpm remove @typescript-eslint/eslint-plugin @typescript-eslint/parser
pnpm add -D typescript-eslint --save-exact
```

### 📋 Dependency Update Requirements
When updating dependencies across Socket projects:

1. **Use taze first**: Run `pnpm run taze` to check and update dependencies systematically
2. **Version Consistency**: All projects MUST use identical versions for shared dependencies
3. **Exact Versions**: Always use `--save-exact` flag to prevent version drift
4. **Batch Updates**: Update all Socket projects simultaneously to maintain alignment
5. **Testing**: Run full test suites after dependency updates to ensure compatibility
6. **Documentation**: Update CLAUDE.md files when standard versions change

### 🔄 Cross-Project Consistency
These standards apply across all Socket repositories:
- `socket-cli`
- `socket-packageurl-js`
- `socket-registry`
- `socket-sdk-js`

When working in any Socket repository, check CLAUDE.md files in other Socket projects for consistency and apply these patterns universally.
