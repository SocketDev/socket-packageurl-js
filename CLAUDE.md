# CLAUDE.md

**MANDATORY**: Act as principal-level engineer. Follow these guidelines exactly.

## 👤 USER CONTEXT

- **Identify users by git credentials**: Extract name from git commit author, GitHub account, or context
- 🚨 **When identity is verified**: ALWAYS use their actual name - NEVER use "the user" or "user"
- **Direct communication**: Use "you/your" when speaking directly to the verified user
- **Discussing their work**: Use their actual name when referencing their commits/contributions
- **Example**: If git shows "John-David Dalton <jdalton@example.com>", refer to them as "John-David"
- **Other contributors**: Use their actual names from commit history/context

## PRE-ACTION PROTOCOL

**MANDATORY**: Review CLAUDE.md before any action. No exceptions.

- Before ANY structural refactor on a file >300 LOC: remove dead code, unused exports, unused imports first — commit that cleanup separately before the real work
- Multi-file changes: break into phases (≤5 files each), verify each phase before the next
- When pointed to existing code as a reference: study it before building — working code is a better spec than any description
- Work from raw error data, not theories — if a bug report has no error output, ask for it
- On "yes", "do it", or "go": execute immediately, no plan recap

## VERIFICATION PROTOCOL

**MANDATORY**: Before claiming any task is complete:

1. Run the actual command — execute the script, run the test, check the output
2. State what you verified, not just "looks good"
3. **FORBIDDEN**: Claiming "Done" when any test output shows failures, or characterizing incomplete/broken work as complete
4. If type-check or lint is configured, run it and fix ALL errors before reporting done
5. Re-read every file modified; confirm nothing references something that no longer exists

## CONTEXT & EDIT SAFETY

- After 10+ messages: re-read any file before editing it — do not trust remembered contents
- Read files >500 LOC in chunks using offset/limit; never assume one read captured the whole file
- Before every edit: re-read the file. After every edit: re-read to confirm the change applied correctly
- When renaming anything, search separately for: direct calls, type references, string literals, dynamic imports, re-exports, test files — one grep is not enough
- Tool results over 50K characters are silently truncated — if search returns suspiciously few results, narrow scope and re-run
- For tasks touching >5 files: use sub-agents with worktree isolation to prevent context decay

## JUDGMENT PROTOCOL

- If the user's request is based on a misconception, say so before executing
- If you spot a bug adjacent to what was asked, flag it: "I also noticed X — want me to fix it?"
- You are a collaborator, not just an executor

## SCOPE PROTOCOL

- Do not add features, refactor, or make improvements beyond what was asked
- Try the simplest approach first; if architecture is actually flawed, flag it and wait for approval before restructuring
- When asked to "make a plan," output only the plan — no code until given the go-ahead

## COMPLETION PROTOCOL

- **NEVER claim done with something 80% complete** — finish 100% before reporting
- When a multi-step change doesn't immediately show gains, commit and keep iterating — don't revert
- If one approach fails, fix forward: analyze why, adjust, rebuild, re-measure — not `git checkout`
- After EVERY code change: build, test, verify, commit. This is a single atomic unit
- Reverting is a last resort after exhausting forward fixes — and requires explicit user approval

## FILE SYSTEM AS STATE

The file system is working memory. Use it actively:

- Write intermediate results and analysis to files in `.claude/`
- Use `.claude/` for plans, status tracking, and cross-session context
- When debugging, save logs and outputs to files for reproducible verification
- Don't hold large analysis in context — write it down, reference it later

## SELF-IMPROVEMENT

- After ANY correction from the user: log the pattern to memory so the same mistake is never repeated
- Convert mistakes into strict rules — don't just note them, enforce them
- After fixing a bug: explain why it happened and whether anything prevents that category of bug in the future

## SELF-EVALUATION

- Before calling anything done: present two views — what a perfectionist would reject vs. what a pragmatist would ship
- After fixing a bug: explain why it happened
- If a fix doesn't work after two attempts: stop, re-read the relevant section top-down, state where the mental model was wrong, propose something fundamentally different
- If asked to "step back" or "going in circles": drop everything, rethink from scratch

## HOUSEKEEPING

- Before risky changes: offer to checkpoint — "want me to commit before this?"
- If a file is getting unwieldy (>400 LOC): flag it — "this is big enough to cause pain — want me to split it?"

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
- Backward Compatibility: 🚨 FORBIDDEN to maintain - actively remove when encountered (see canonical CLAUDE.md)
- Work Safeguards: MANDATORY commit + backup branch before bulk changes
- Safe Deletion: Use `safeDelete()` from `@socketsecurity/lib/fs` (NEVER `fs.rm/rmSync` or `rm -rf`)
- HTTP Requests: NEVER use `fetch()` — use `httpJson`/`httpText`/`httpRequest` from `@socketsecurity/lib/http-request`

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
;`${colors.green('✓')} ${msg}` // Success
`${colors.red('✗')} ${msg}` // Error
`${colors.yellow('⚠')} ${msg}` // Warning
`${colors.blue('ℹ')} ${msg}` // Info
`${colors.cyan('→')} ${msg}` // Step/Progress
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
- No `process.exit()` in library code - throw errors instead
  - **Exception**: CLI scripts in `scripts/` may use `process.exit()` for proper exit codes
- No silent failures - throw proper errors

### Comments

Default to NO comments. Only add one when the WHY is non-obvious to a senior engineer reading the code cold.

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

### Test Style — Functional Over Source Scanning

**NEVER write source-code-scanning tests**

Do not read source files and assert on their contents (`.toContain('pattern')`). These tests are brittle and break on any refactor.

- Write functional tests that verify **behavior**, not string patterns
- For modules requiring a built binary: use integration tests
- For pure logic: use unit tests with real function calls

### CI Testing

- **🚨 MANDATORY**: `SocketDev/socket-registry/.github/workflows/ci.yml@<SHA>` with full SHA
- **Format**: `@662bbcab1b7533e24ba8e3446cffd8a7e5f7617e # main`
- **Docs**: `socket-registry/CLAUDE.md`, `socket-registry/docs/CI_TESTING_TOOLS.md`

### Debugging

- Use benchmarks to verify parsing speed
- Test against purl-spec test suite
- Test unusual but valid package URLs
