# quality-scan Reference Documentation

## Agent Prompts

### Critical Scan Agent

**Mission**: Identify critical bugs that could cause crashes, data corruption, or security vulnerabilities in PURL processing.

**Scan Targets**: All `.ts` files in `src/`

**Prompt Template:**
```
Your task is to perform a critical bug scan on a TypeScript Package URL (PURL) parser and builder library. Identify bugs that could cause crashes, data corruption, or security vulnerabilities.

<context>
This is a production PURL library (socket-packageurl-js) that:
- Parses and constructs Package URLs per PURL specification
- Processes untrusted input (user-provided strings, JSON)
- Used by Socket.dev for security scanning of 35+ package ecosystems
- Must handle malformed input gracefully without crashes
- Performance-critical (high-volume scanning)
</context>

<instructions>
Scan all TypeScript files in src/**/*.ts for these critical bug patterns:

<pattern name="null_undefined_access">
- Property access without optional chaining when value might be null/undefined
- Array access without length validation (arr[0], arr[arr.length-1])
- JSON.parse() without try-catch
- Object destructuring without null checks
- URLSearchParams operations without validation
</pattern>

<pattern name="unhandled_promises">
- Async function calls without await or .catch()
- Promise.then() chains without .catch() handlers
- Fire-and-forget promises that could reject
- Missing error handling in async/await blocks
</pattern>

<pattern name="type_coercion">
- Equality comparisons using == instead of ===
- Implicit type conversions that could fail silently
- Truthy/falsy checks where explicit null/undefined checks needed
- typeof checks that miss edge cases (typeof null === 'object')
</pattern>

<pattern name="resource_leaks">
- Timers created but not cleared (setTimeout/setInterval)
- Event listeners added but not removed
- Memory accumulation in memoization/caching
- Circular references preventing GC
</pattern>

<pattern name="buffer_overflow">
- String slicing without bounds validation
- Array indexing beyond length
- Buffer operations without size checks
- Regex with unbounded quantifiers (ReDoS)
</pattern>

<pattern name="security">
- Prototype pollution in Object.assign() or spread
- Command injection in child_process
- Path traversal in file operations
- Insufficient input validation on untrusted data
</pattern>

For each bug found, think through:
1. Can this actually crash in production?
2. What input would trigger it?
3. Is there existing safeguards I'm missing?
</instructions>

<output_format>
For each finding, report:

File: src/path/to/file.ts:lineNumber
Issue: [One-line description of the bug]
Severity: Critical
Pattern: [The problematic code snippet]
Trigger: [What input/condition causes the bug]
Fix: [Specific code change to fix it]
Impact: [What happens if this bug is triggered]

Example:
File: src/package-url.ts:145
Issue: Unhandled URL parsing exception
Severity: Critical
Pattern: `new URL(purlStr)`
Trigger: When purlStr contains invalid URL characters
Fix: `try { new URL(purlStr) } catch (e) { throw new PurlError('invalid URL', { cause: e }) }`
Impact: Uncaught exception crashes parsing process
</output_format>

<quality_guidelines>
- Only report actual bugs, not style issues or minor improvements
- Verify bugs are not already handled by surrounding code
- Prioritize bugs affecting production reliability
- Skip false positives (TypeScript type guards are sufficient in many cases)
- Focus on code paths processing external input
</quality_guidelines>

Scan systematically through src/ and report all critical bugs found. If no critical bugs are found, state that explicitly.
```

---

### Logic Scan Agent

**Mission**: Detect logical errors in PURL parsing, encoding, normalization that could produce incorrect output.

**Scan Targets**: `src/**/*.ts` with focus on `package-url.ts`, `purl-component.ts`, `purl-type.ts`

**Prompt Template:**
```
Your task is to detect logic errors in PURL parsing and construction that could produce incorrect Package URLs. Focus on algorithm correctness, edge case handling, and spec compliance.

<context>
This PURL library:
- Parses PURL strings: pkg:type/namespace/name@version?qualifiers#subpath
- Constructs PURLs from components with validation and normalization
- Supports 35+ package ecosystems (npm, pypi, maven, cargo, gem, nuget, etc.)
- Each ecosystem has specific normalization rules (case, characters, encoding)
- Must comply with PURL specification exactly
- Used for security analysis where accuracy is critical
</context>

<instructions>
Analyze src/**/*.ts for these logic error patterns:

<pattern name="off_by_one">
Off-by-one errors in parsing and string operations:
- Loop bounds: `i <= str.length` should be `i < str.length`
- Slice operations: `str.slice(0, len-1)` when full string needed
- String indexing missing first/last character
- indexOf/lastIndexOf checks that miss position 0
</pattern>

<pattern name="type_guards">
Insufficient type validation:
- `if (obj)` allows 0, "", false - use `obj != null` or explicit checks
- `if (str.length)` crashes if str is undefined - check existence first
- `typeof x === 'object'` true for null and arrays - use Array.isArray() or null check
- Missing validation before destructuring or property access
</pattern>

<pattern name="edge_cases">
Unhandled edge cases in string/array operations:
- `str.split('@')[0]` when delimiter might not exist
- `lastIndexOf('@')` returns -1 if not found, === 0 is valid (e.g., '@scope/package')
- Empty strings, empty arrays, single-element arrays
- Malformed input handling (missing try-catch, no fallback)
- Special characters in PURL components (%, @, /, #, ?, &, =)
</pattern>

<pattern name="algorithm_correctness">
Algorithm implementation issues:
- Incorrect URL encoding/decoding (percent-encoding rules)
- Case normalization failing on edge cases (locale, unicode)
- Qualifier sorting not alphabetical as per spec
- Namespace handling for scoped packages (@scope/name)
- Version string processing (stripping 'v' prefix, handling ranges)
</pattern>

<pattern name="purl_generation">
Package URL generation errors:
- Namespace: empty strings, special characters not encoded, null handling
- Version: missing URL encoding for special chars (+, @, /, %)
- Qualifiers: not sorted alphabetically as per spec
- Type: incorrect ecosystem mapping
- Subpath: incorrect encoding, missing leading slash normalization
</pattern>

<pattern name="parser_robustness">
Insufficient input validation:
- Empty strings or whitespace-only strings
- Missing required components (type, name)
- Unexpected data types (number instead of string, null instead of object)
- Malformed PURLs with incomplete structure
- pkg:// with double slashes should strip slashes
</pattern>

<pattern name="comparison_logic">
Comparison and equality errors:
- equals() not handling all component differences
- compare() not producing consistent ordering
- Hash/identity not matching equality semantics
</pattern>

Before reporting, think through:
1. Does this logic error produce incorrect output?
2. What specific input would trigger it?
3. Is the error already handled elsewhere?
</instructions>

<output_format>
For each finding, report:

File: src/path/to/file.ts:lineNumber
Issue: [One-line description]
Severity: High | Medium
Edge Case: [Specific input that triggers the error]
Pattern: [The problematic code snippet]
Fix: [Corrected code]
Impact: [What incorrect output is produced]

Example:
File: src/decode.ts:45
Issue: Incorrect percent-decoding for plus signs in qualifiers
Severity: High
Edge Case: PURL with qualifier value containing '+'
Pattern: `decodeURIComponent(value)`
Fix: `decodeURIComponent(value.replace(/\+/g, ' '))`
Impact: Plus signs in qualifiers decoded incorrectly, violating spec
</output_format>

<quality_guidelines>
- Prioritize parsing/encoding logic that affects correctness
- Focus on errors affecting output accuracy, not performance
- Verify logic errors aren't false alarms due to type narrowing
- Consider real-world PURL patterns for each ecosystem
- Check against PURL specification requirements
</quality_guidelines>

Analyze systematically and report all logic errors found. If no errors are found, state that explicitly.
```

---

### Spec Compliance Scan Agent

**Mission**: Identify violations of the PURL specification (purl-spec) and ecosystem-specific requirements.

**Scan Targets**: `src/purl-type.ts`, `src/purl-component.ts`, `src/normalize.ts`, `src/validate.ts`

**Prompt Template:**
```
Your task is to verify compliance with the Package URL specification (github.com/package-url/purl-spec) and identify spec violations in normalization, validation, and encoding logic.

<context>
The PURL specification defines:
- Component structure: scheme://type/namespace/name@version?qualifiers#subpath
- Encoding rules: percent-encoding for special characters
- Normalization rules: type-specific (npm lowercase, pypi dash conversion, etc.)
- Qualifier ordering: alphabetical by key
- Type-specific requirements: namespace rules, character restrictions

This library must comply exactly with:
- PURL-SPECIFICATION.rst for core format
- types-doc/*.md for ecosystem-specific rules (cargo, gem, nuget, npm, pypi, maven, etc.)
</context>

<instructions>
Analyze implementation for spec compliance in these areas:

<pattern name="encoding_violations">
Percent-encoding spec violations:
- Special characters not encoded per RFC3986: !, *, ', (, ), ;, :, @, &, =, +, $, ,, /, ?, #, [, ], %
- Over-encoding: encoding characters that shouldn't be encoded (a-z, A-Z, 0-9, -, ., _, ~)
- Encoding in wrong components (e.g., encoding @ in version)
- Double-encoding issues
</pattern>

<pattern name="normalization_violations">
Type-specific normalization errors:
- **npm**: Should lowercase name (except legacy), lowercase namespace
- **pypi**: Should lowercase name, convert underscores to dashes
- **pub**: Should lowercase name, convert dashes to underscores
- **cargo**: Case-sensitive, no normalization
- **gem**: Case-sensitive, no normalization
- **nuget**: Case-preserving, no normalization
- **maven**: Case-sensitive, no normalization
- **golang**: Case-sensitive (pending spec change)
</pattern>

<pattern name="validation_violations">
Type-specific validation errors:
- **cargo**: Must not have namespace
- **gem**: Must not have namespace
- **nuget**: Must not have namespace
- **maven**: Must have namespace (groupId)
- **swift**: Must have namespace and version
- **npm**: Name restrictions (214 chars, URL-friendly, not node_modules)
- **cocoapods**: Name cannot contain whitespace or + or start with .
- **pub**: Name must match [a-z0-9_]+
- **swid**: Must have tag_id qualifier
</pattern>

<pattern name="qualifier_violations">
Qualifier spec violations:
- Not sorted alphabetically by key
- Keys not lowercase
- Empty qualifier values when not allowed
- Reserved qualifier names used incorrectly
- Qualifier encoding incorrect
</pattern>

<pattern name="scheme_violations">
Core format violations:
- Accepting "pkg://" when spec says strip leading slashes
- Not rejecting URLs with authority (user:pass@host:port)
- Accepting invalid scheme (not "pkg:")
- Missing required components (type, name)
</pattern>

<pattern name="subpath_violations">
Subpath handling errors:
- Not normalizing leading slashes (should remove)
- Not collapsing . and .. segments
- Incorrect percent-encoding
- Accepting absolute paths when relative required
</pattern>

Review each type definition in src/purl-type.ts against:
- types-doc/{type}-definition.md from purl-spec
- PURL-TYPES.rst from purl-spec

For each violation, cite the spec section:
1. Which spec document?
2. What does spec require?
3. What does code do instead?
</instructions>

<output_format>
For each finding, report:

File: src/path/to/file.ts:lineNumber
Issue: [Spec violation description]
Severity: High | Medium
Spec Reference: [purl-spec doc and section]
Expected Behavior: [What spec requires]
Actual Behavior: [What code does]
Fix: [Code change to comply with spec]

Example:
File: src/purl-type.ts:234
Issue: npm normalization not lowercasing namespace
Severity: High
Spec Reference: types-doc/npm-definition.md section "Normalization"
Expected Behavior: Namespace should be lowercased per spec
Actual Behavior: Namespace is not normalized
Fix: Add `lowerNamespace(purl)` to npm normalizer
</output_format>

<quality_guidelines>
- Cross-reference all type implementations with types-doc/*.md
- Verify encoding against RFC3986 and PURL spec
- Check test files (test/purl-spec.test.mts) for spec test coverage
- Cite specific spec sections for each violation
- Distinguish between spec violations and implementation choices
</quality_guidelines>

Analyze systematically and report all spec violations found. If implementation is fully compliant, state that explicitly.
```

---

### Workflow Scan Agent

**Mission**: Detect problems in build scripts, CI configuration, git hooks, and developer workflows.

**Scan Targets**: `scripts/*.mjs`, `package.json`, `.github/workflows/*`, CI configs

**Prompt Template:**
```
Your task is to identify issues in development workflows, build scripts, and CI configuration that could cause build failures, test flakiness, or poor developer experience.

<context>
This project uses:
- Build scripts: scripts/*.mjs (ESM, cross-platform Node.js)
- Package manager: pnpm with scripts in package.json
- Git hooks: Husky for pre-commit validation
- CI: GitHub Actions (.github/workflows/)
- Platforms: Must work on Windows, macOS, Linux
- CLAUDE.md defines conventions (no process.exit(), colored output with yoctocolors-cjs, etc.)
</context>

<instructions>
Analyze workflow files for these issue categories:

<pattern name="scripts_cross_platform">
Cross-platform compatibility in scripts/*.mjs:
- Path separators: Hardcoded / or \ instead of path.join() or path.resolve()
- Shell commands: Platform-specific (e.g., rm vs del, cp vs copy)
- Line endings: \n vs \r\n handling in text processing
- File paths: Case sensitivity differences (Windows vs Linux)
- Environment variables: Different syntax (%VAR% vs $VAR)
</pattern>

<pattern name="scripts_errors">
Error handling in scripts:
- process.exit() usage: CLAUDE.md forbids this - should throw errors instead
- Missing try-catch: Async operations without error handling
- Exit codes: Non-zero exit on failure for CI detection
- Error messages: Should use colored symbols (✓✗⚠ℹ→) from yoctocolors-cjs
- Dependency checks: Do scripts check for required tools before use?

**Note on file existence checks**: existsSync() is ACCEPTABLE and actually PREFERRED over async fs.access() for synchronous file checks. Node.js has quirks where the synchronous check is more reliable for immediate validation. Do NOT flag existsSync() as an issue.
</pattern>

<pattern name="package_json_scripts">
package.json script correctness:
- Script chaining: Use && (fail fast) not ; (continue on error) when errors matter
- Platform-specific: Commands that don't work cross-platform (grep, find, etc.)
- Convention compliance: Match patterns in CLAUDE.md (e.g., `pnpm run foo --flag`)
- Missing scripts: Standard scripts like build, test, lint documented?
</pattern>

<pattern name="ci_configuration">
CI pipeline issues (.github/workflows/):
- Build order: Are steps in correct sequence (install → build → test)?
- Test coverage: Is coverage collected and reported?
- Matrix testing: Node.js versions, OS variations?
- Caching: Are dependencies cached for speed?
- Artifact generation: Are build artifacts uploaded?
</pattern>

<pattern name="git_hooks">
Git hooks configuration (via Husky):
- Pre-commit: Does it run formatting/linting? Is it fast (<10s)?
- Pre-push: Does it run tests to prevent broken pushes?
- False positives: Do hooks block legitimate commits?
- Error messages: Are hook failures clearly explained?
</pattern>

<pattern name="developer_experience">
Documentation and setup:
- README: Setup instructions clear and complete?
- CLAUDE.md: Conventions documented?
- Required tools: List of prerequisites (Node.js version, pnpm, etc.)?
- First-time setup: Can a new contributor get started easily?
</pattern>

For each issue, consider:
1. Does this actually affect developers or CI?
2. How often would this be encountered?
3. Is there a simple fix?
</instructions>

<output_format>
For each finding, report:

File: [scripts/foo.mjs:line OR package.json:scripts.build OR .github/workflows/ci.yml:line]
Issue: [One-line description]
Severity: Medium | Low
Impact: [How this affects developers or CI]
Pattern: [The problematic code or configuration]
Fix: [Specific change to resolve]

Example:
File: scripts/build.mjs:23
Issue: Uses process.exit() violating CLAUDE.md convention
Severity: Medium
Impact: Cannot be tested properly, unconventional error handling
Pattern: `process.exit(1)`
Fix: `throw new Error('Build failed: ...')`
</output_format>

<quality_guidelines>
- Focus on issues that cause actual build/test failures
- Consider cross-platform scenarios (Windows, macOS, Linux)
- Verify conventions match CLAUDE.md requirements
- Prioritize developer experience issues (confusing errors, missing docs)
</quality_guidelines>

Analyze workflow files systematically and report all issues found. If workflows are well-configured, state that explicitly.
```

---

## Scan Configuration

### Severity Levels

| Level | Description | Action Required |
|-------|-------------|-----------------|
| **Critical** | Crashes, security vulnerabilities, data corruption | Fix immediately |
| **High** | Logic errors, spec violations, incorrect output | Fix before release |
| **Medium** | Performance issues, edge case bugs, workflow problems | Fix in next sprint |
| **Low** | Code smells, minor inconsistencies | Fix when convenient |

### Scan Priority Order

1. **critical** - Most important, run first
2. **logic** - Parser/builder correctness critical for accuracy
3. **spec** - PURL specification compliance
4. **workflow** - Developer experience

### Coverage Targets

- **critical**: All src/ files
- **logic**: src/package-url.ts, src/purl-component.ts, src/purl-type.ts, src/encode.ts, src/decode.ts
- **spec**: src/purl-type.ts, src/purl-component.ts, src/normalize.ts, src/validate.ts
- **workflow**: scripts/, package.json, .github/, .husky/

---

## Report Format

### Structured Findings

Each finding should include:
```typescript
{
  file: "src/package-url.ts:89",
  issue: "Potential null pointer access on URL parsing",
  severity: "Critical",
  scanType: "critical",
  pattern: "new URL(str) without try-catch",
  suggestion: "Wrap in try-catch and throw PurlError",
  impact: "Crash on malformed input"
}
```

### Example Report Output

```markdown
# Quality Scan Report

**Date:** 2026-02-06
**Scans:** critical, logic, spec, workflow
**Files Scanned:** 18
**Findings:** 0 critical, 2 high, 3 medium, 1 low

## High Issues (Priority 2) - 2 found

### src/purl-type.ts:145
- **Issue**: Missing validation for ecosystem-specific constraints
- **Pattern**: No check for namespace requirement
- **Fix**: Add validateRequiredByType() check
- **Impact**: Accepts invalid PURLs that violate spec

### src/package-url.ts:234
- **Issue**: Edge case in version range handling
- **Pattern**: Doesn't handle '||' or operator
- **Fix**: Add OR operator handling in fromNPM()
- **Impact**: Incorrect version extraction for complex ranges

## Medium Issues (Priority 3) - 3 found

...

## Scan Coverage
- **Critical scan**: 18 files analyzed in src/
- **Logic scan**: 6 core files + 12 utils analyzed
- **Spec scan**: 4 type definition files analyzed
- **Workflow scan**: 8 scripts + package.json + CI config

## Recommendations
1. Review 2 high-severity issues before next release
2. Schedule medium issues for next sprint
3. Low-priority items can be addressed during refactoring
```

---

## Edge Cases

### No Findings

If scan finds no issues:
```markdown
# Quality Scan Report

**Result**: ✓ No issues found

All scans completed successfully with no findings.

- Critical scan: ✓ Clean
- Logic scan: ✓ Clean
- Spec scan: ✓ Clean
- Workflow scan: ✓ Clean

**Code quality**: Excellent
```

### Partial Scans

User can request specific scan types:
```bash
# Only run critical and spec scans
quality-scan --types critical,spec
```

Report only includes requested scan types and notes which were skipped.
