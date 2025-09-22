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

This is a JavaScript implementation of the Package URL (purl) specification for parsing and constructing package URLs.

### Core Structure
- **Main entry**: `src/index.js` - Main exports and API
- **Parser**: Core parsing logic for purl strings
- **Normalizer**: Normalization logic for different package types
- **Validator**: Input validation and sanitization
- **Types**: Type-specific handling for npm, pypi, maven, etc.
- **Scripts**: `scripts/` - Build and utility scripts
- **Tests**: `test/` - Comprehensive test suite

### Key Features
- Full purl specification compliance
- High-performance parsing
- Type-specific normalization
- Comprehensive validation
- Extensive test coverage

## 🔧 Code Style (MANDATORY)

### 📁 File Organization
- **File extensions**: Use `.js` for JavaScript files, `.mjs` for ES modules
- **Import order**: Node.js built-ins first, then third-party packages, then local imports
- **Import grouping**: Group imports by source (Node.js, external packages, local modules)
- **Type imports**: When using JSDoc, keep type imports organized

### Naming Conventions
- **Constants**: Use `UPPER_SNAKE_CASE` for constants
- **Files**: Use kebab-case for filenames
- **Variables**: Use camelCase for variables and functions
- **Classes**: Use PascalCase for classes

### 🏗️ Code Structure (CRITICAL PATTERNS)
- **Error handling**: 🚨 REQUIRED - Use try-catch blocks and handle errors gracefully
- **Array destructuring**: Use object notation `{ 0: key, 1: data }` instead of array destructuring `[key, data]`
- **Comment periods**: 🚨 MANDATORY - ALL comments MUST end with periods. This includes single-line comments, multi-line comments, and inline comments. No exceptions.
- **Comment placement**: Place comments on their own line, not to the right of code
- **Comment formatting**: Use fewer hyphens/dashes and prefer commas, colons, or semicolons for better readability
- **Sorting**: 🚨 MANDATORY - Always sort lists, exports, and items alphabetically for consistency
- **Await in loops**: When using `await` inside for-loops, add `// eslint-disable-next-line no-await-in-loop` when sequential processing is intentional
- **If statement returns**: Never use single-line return if statements; always use proper block syntax with braces
- **List formatting**: Use `-` for bullet points in text output, not `•` or other Unicode characters
- **Existence checks**: Perform simple existence checks first before complex operations
- **Destructuring order**: Sort destructured properties alphabetically in const declarations
- **Function ordering**: Place functions in alphabetical order, with private functions first, then exported functions
- **Object mappings**: Use objects with `__proto__: null` for static mappings to prevent prototype pollution
- **Array length checks**: Use `!array.length` instead of `array.length === 0`
- **Catch parameter naming**: Use `catch (e)` instead of `catch (error)` for consistency
- **Number formatting**: 🚨 REQUIRED - Use underscore separators (e.g., `20_000`) for large numeric literals

### 🗑️ Safe File Operations (SECURITY CRITICAL)
- **File deletion**: 🚨 ABSOLUTELY FORBIDDEN - NEVER use `rm -rf`. 🚨 MANDATORY - ALWAYS use `pnpm dlx trash-cli`
- **Examples**:
  - ❌ CATASTROPHIC: `rm -rf directory` (permanent deletion - DATA LOSS RISK)
  - ❌ REPOSITORY DESTROYER: `rm -rf "$(pwd)"` (deletes entire repository)
  - ✅ SAFE: `pnpm dlx trash-cli directory` (recoverable deletion)
- **Why this matters**: trash-cli enables recovery from accidental deletions via system trash/recycle bin

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