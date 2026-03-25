---
name: updating-npm-purl-package
description: Syncs socket-packageurl-js feature parity with the purl npm package (https://github.com/ljharb/purl). Checks for new API features, URL type coverage, registry validation support, and normalization behaviors. Triggers when user mentions "sync purl package", "purl feature parity", or "check purl npm".
user-invocable: true
allowed-tools: Agent, Bash, Read, Write, Edit, Grep, Glob, WebFetch
---

# updating-npm-purl-package

<task>
Your task is to compare socket-packageurl-js against the purl npm package (https://github.com/ljharb/purl) and implement any missing features or fix any behavioral differences to maintain feature parity.
</task>

<context>
**What is this?**
The `purl` npm package by Jordan Harband is a reference TC54 PURL implementation. socket-packageurl-js should maintain feature parity with it while preserving our additional features (builder pattern, Result types, pattern matching, etc.).

**Upstream Package:**
- **npm:** `purl` (https://www.npmjs.com/package/purl)
- **Repository:** https://github.com/ljharb/purl
- **Standard:** TC54/ECMA-427

**Feature Comparison Areas:**
1. **URL type coverage** - registry URL generation for each ecosystem
2. **Registry validation** - which ecosystems support existence checks
3. **Normalization behavior** - type-specific case and encoding rules
4. **Component handling** - edge cases in parsing and serialization
5. **API surface** - new functions or methods added upstream

**Reference:** See [reference.md](reference.md) for detailed feature comparison matrix and implementation guidance.
</context>

<constraints>
**Requirements:**
- Start with clean working directory
- Never remove existing features (only add or fix)
- Maintain 100% test coverage
- All changes must pass `pnpm run check && pnpm test`

**CI Mode** (detected via `CI=true` or `GITHUB_ACTIONS`):
- Create atomic commits, skip build validation

**Interactive Mode** (default):
- Report feature gaps to user before implementing
- Validate each change with build/tests

**Do NOT:**
- Copy code from the purl package (different license terms may apply)
- Remove or change our additional features (builder, Result types, matching)
- Change the public API signature of existing functions without user approval

**Do ONLY:**
- Add missing URL type handlers
- Add missing registry validation support
- Fix normalization differences that deviate from TC54 spec
- Add new API features that the purl package offers
</constraints>

<instructions>

## Process

### Phase 1: Validate Environment

<action>
Check working directory and detect mode:
</action>

```bash
if [ "$CI" = "true" ] || [ -n "$GITHUB_ACTIONS" ]; then
  CI_MODE=true
else
  CI_MODE=false
fi
git status --porcelain
```

---

### Phase 2: Fetch Upstream Package Info

<action>
Get the latest purl package version and check for changes:
</action>

```bash
# Current purl version
npm view purl version

# Check purl changelog/releases
gh api repos/ljharb/purl/releases --jq '.[0:5] | .[] | {tag: .tag_name, date: .published_at, name: .name}'

# Get recent commits for feature changes
gh api repos/ljharb/purl/commits --jq '.[0:20] | .[] | {sha: .sha[0:7], date: .commit.author.date, message: .commit.message}'
```

---

### Phase 3: Compare URL Type Coverage

<action>
Compare registry URL generation between purl and our implementation:
</action>

**purl supports URL generation for:**
bioconductor, bitbucket, cargo, chrome, clojars, cocoapods, composer, conan, conda, cpan, deno, docker, elm, gem, github, golang, hackage, hex, homebrew, huggingface, luarocks, maven, npm, nuget, pub, pypi, swift, vscode

**Check our UrlConverter coverage:**

```bash
# Extract types from our url-converter.ts
grep "case '" src/url-converter.ts | sed "s/.*case '//;s/'.*//" | sort -u
```

Compare lists. Missing types need new case handlers in `src/url-converter.ts`.

---

### Phase 4: Compare Registry Validation Coverage

<action>
Compare registry existence checking support:
</action>

**purl validate() supports:**
npm, pypi, gem, cargo, nuget, hex, maven, composer, pub, hackage, cocoapods

**Check our purlExists coverage:**

```bash
grep -E 'Exists\(' src/purl-exists.ts | grep 'export' | sed 's/.*function //;s/Exists.*//' | sort
```

Compare lists and identify gaps.

---

### Phase 5: Compare Normalization Behaviors

<action>
Test key normalization differences:
</action>

For each supported type, compare how purl and our implementation normalize:
- Type casing
- Namespace casing and encoding
- Name casing and encoding
- Version encoding
- Qualifier key ordering
- `@` encoding in npm scoped packages

Use the purl npm package's test suite as a reference:

```bash
gh api repos/ljharb/purl/contents/test --jq '.[].name'
```

---

### Phase 6: Implement Missing Features

<action>
For each identified gap, implement the feature:
</action>

For each missing URL type:
1. Add case handler to `src/url-converter.ts` (both `toRepositoryUrl` and `toDownloadUrl`)
2. Add test cases to `test/url-converter.test.mts`

For each missing registry validator:
1. Add function to `src/purl-exists.ts`
2. Add test cases to corresponding `test/registry-*.test.mts`

For normalization fixes:
1. Update type handler in `src/purl-types/{type}.ts`
2. Add edge case tests

```bash
# Validate after each change
pnpm run check
pnpm test
```

Commit atomically per logical feature:

```bash
git add <files>
git commit -m "feat(url-converter): add {type} registry URL support

Added repository and download URL generation for {type} ecosystem."
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
Generate feature parity report:
</action>

```
## Feature Parity Sync Complete

### purl npm package version: vX.Y.Z

### URL Type Coverage:
| Type | purl | socket-packageurl-js | Status |
|------|------|---------------------|--------|
| ... | ... | ... | Added/Already supported/N/A |

### Registry Validation:
| Type | purl | socket-packageurl-js | Status |
|------|------|---------------------|--------|
| ... | ... | ... | Added/Already supported |

### Normalization Fixes:
- [list any fixes applied]

### API Features:
- [list any new features added]

### Commits Created:
- [list commits]
```

</instructions>

## Success Criteria

- URL type coverage matches or exceeds purl package
- Registry validation covers all purl-supported types
- Normalization behavior matches TC54 spec
- All tests pass with 100% coverage
- Feature parity report generated

## Context

This skill is useful for:

- Monthly feature parity checks
- After new purl npm releases
- Before major version releases
- When users report behavioral differences vs purl package

**Safety:** Read-only analysis first, changes only after user review (interactive mode).
