---
name: updating-spec
description: Syncs socket-packageurl-js against upstream PURL and VERS specifications. Checks purl-spec, vers-spec, TC54/ECMA-427 standards, and the purl npm package for new types, test cases, normalization rules, and spec changes. Triggers when user mentions "update spec", "sync spec", "purl spec changes", or "check upstream".
user-invocable: true
allowed-tools: Agent, Task, Bash, Read, Write, Edit, Grep, Glob, WebFetch
---

# updating-spec

<task>
Your task is to sync socket-packageurl-js against the latest upstream PURL and VERS specifications, identifying new types, changed normalization rules, updated test suites, and spec clarifications that require code or test changes.
</task>

<context>
**What is this?**
socket-packageurl-js is a TypeScript implementation of the Package URL specification (ECMA-427). It must stay aligned with multiple upstream sources that evolve independently.

**Upstream Sources:**

| Source | URL | What to Check |
|--------|-----|---------------|
| purl-spec | https://github.com/package-url/purl-spec | PURL-SPECIFICATION.rst, PURL-TYPES.rst, test suite |
| vers-spec | https://github.com/package-url/vers-spec | VERSION-RANGE-SPEC.rst, test suite |
| TC54/ECMA-427 | https://tc54.org/purl/ | Standard updates, meeting notes |
| purl npm package | https://www.npmjs.com/package/purl | API changes, new features, version bumps |
| purl-spec test suite | test/data/spec/specification-test.json | Official compliance tests |

**Current Implementation:**
- 41 package type handlers in `src/purl-types/`
- Official test suite at `test/data/spec/specification-test.json`
- Community tests at `test/data/contrib-tests.json`
- Type-specific tests in `test/data/types/`

**Reference:** See [reference.md](reference.md) for detailed spec comparison procedures, type registry, and edge cases.
</context>

<constraints>
**Requirements:**
- Start with clean working directory (no uncommitted changes)
- Read reference.md for detailed procedures before starting
- Never break existing passing tests
- Maintain 100% test coverage

**CI Mode** (detected via `CI=true` or `GITHUB_ACTIONS`):
- Create atomic commits, skip build validation
- Workflow handles push and PR creation

**Interactive Mode** (default):
- Validate each change with build/tests before proceeding
- Report findings to user for review before committing

**Do NOT:**
- Implement draft or unratified spec changes without user confirmation
- Remove existing type support without spec justification
- Modify test suite data without verifying against upstream

**Do ONLY:**
- Sync from official upstream sources
- Add new types that are ratified in the spec
- Update test suites from upstream
- Fix normalization/validation to match spec clarifications
</constraints>

<instructions>

## Process

### Phase 1: Validate Environment

<action>
Check working directory is clean and detect CI mode:
</action>

```bash
if [ "$CI" = "true" ] || [ -n "$GITHUB_ACTIONS" ]; then
  CI_MODE=true
  echo "Running in CI mode"
else
  CI_MODE=false
  echo "Running in interactive mode"
fi

git status --porcelain
```

<validation>
- Working directory must be clean
- CI_MODE detected for subsequent phases
</validation>

---

### Phase 2: Fetch Upstream Spec Changes

<action>
Check each upstream source for changes since last sync:
</action>

**2.1: purl-spec repository**

```bash
# Get recent commits
gh api repos/package-url/purl-spec/commits --jq '.[0:30] | .[] | {sha: .sha[0:7], date: .commit.author.date, message: .commit.message}' 2>/dev/null

# Check for changes to core spec files
gh api repos/package-url/purl-spec/commits --jq '.[0:30] | .[] | select(.commit.message | test("SPECIFICATION|TYPES|test"; "i")) | {sha: .sha[0:7], message: .commit.message}'
```

**2.2: vers-spec repository**

```bash
gh api repos/package-url/vers-spec/commits --jq '.[0:30] | .[] | {sha: .sha[0:7], date: .commit.author.date, message: .commit.message}' 2>/dev/null
```

**2.3: purl npm package**

```bash
npm view purl version description 2>/dev/null
```

**2.4: TC54 status**

Check https://tc54.org/purl/ for standard updates via WebFetch.

---

### Phase 3: Compare Spec Types Against Implementation

<action>
Identify new, modified, or deprecated PURL types:
</action>

```bash
# List our implemented types
ls src/purl-types/ | sed 's/\.ts$//' | sort

# Fetch current PURL-TYPES.rst from upstream
gh api repos/package-url/purl-spec/contents/PURL-TYPES.rst --jq '.content' | base64 -d | grep -E '^\*\*' | head -60
```

Compare the lists to identify:
- New types in spec not yet implemented
- Types we implement that may have changed rules
- Deprecated types

---

### Phase 4: Sync Test Suite

<action>
Update the official purl-spec test suite data:
</action>

```bash
# Fetch latest test suite from purl-spec
gh api repos/package-url/purl-spec/contents/test-suite-data.json --jq '.content' | base64 -d > /tmp/purl-spec-tests.json

# Compare with our copy
diff <(cat test/data/spec/specification-test.json | python3 -m json.tool) <(cat /tmp/purl-spec-tests.json | python3 -m json.tool) || echo "Test suite has changes"
```

If changes exist:
1. Review the diff for new test cases
2. Copy updated test suite to `test/data/spec/specification-test.json`
3. Run tests to identify failures
4. Fix implementation to pass new tests

---

### Phase 5: Review Normalization and Validation Rules

<action>
Check for spec clarifications affecting normalization or validation:
</action>

For each type with spec changes, review:
- Case normalization rules (type, namespace, name)
- Required vs optional qualifiers
- Namespace separator rules
- Version encoding requirements
- Subpath handling

See reference.md for type-specific normalization rules.

---

### Phase 6: Implement Changes

<action>
Apply necessary code changes (interactive mode: confirm with user first):
</action>

For each required change:
1. Update type handler in `src/purl-types/`
2. Add or update tests in `test/`
3. Update type-specific test data in `test/data/types/`
4. Run validation: `pnpm run check && pnpm test`
5. Commit atomically per logical change

```bash
# Validate after each change
pnpm run check
pnpm test
pnpm run cover  # Must maintain 100%
```

---

### Phase 7: Final Validation

<action>
Run full validation (skip in CI mode):
</action>

```bash
if [ "$CI_MODE" = "true" ]; then
  echo "CI mode: Skipping final validation"
else
  pnpm run fix
  pnpm run check
  pnpm test
  pnpm run cover
fi
```

---

### Phase 8: Report Summary

<action>
Generate spec sync report:
</action>

```
## Spec Sync Complete

### Upstream Changes Detected:

| Source | Changes Found | Action Taken |
|--------|--------------|--------------|
| purl-spec | X commits | [details] |
| vers-spec | X commits | [details] |
| TC54/ECMA-427 | [status] | [details] |
| purl npm package | vX.Y.Z | [details] |

### Types Added/Updated:
- [list any new or modified type handlers]

### Test Suite:
- Official tests: Updated/No changes
- Coverage: 100%

### Commits Created:
- [list commits]

### Next Steps:
**Interactive mode:**
1. Review changes: `git log --oneline -N`
2. Push to remote: `git push origin main`

**CI mode:**
1. Workflow will push branch and create PR
```

</instructions>

## Success Criteria

- All upstream sources checked for changes
- Test suite synced with purl-spec
- New types implemented if ratified
- Normalization rules updated per spec clarifications
- Full build and tests pass
- 100% test coverage maintained
- Comprehensive report generated

## Context

This skill is useful for:

- Monthly spec compliance checks
- After TC54 meetings or spec releases
- Before major version releases
- When users report spec compliance issues

**Safety:** Changes are validated before committing. Interactive mode requires user confirmation for non-trivial changes.
