# updating-spec Reference Documentation

This document provides detailed information about upstream PURL and VERS specifications, type registries, normalization rules, and sync procedures for the updating-spec skill.

## Table of Contents

1. [Upstream Sources](#upstream-sources)
2. [PURL Type Registry](#purl-type-registry)
3. [Specification Components](#specification-components)
4. [VERS Specification](#vers-specification)
5. [TC54/ECMA-427 Standard](#tc54ecma-427-standard)
6. [purl npm Package](#purl-npm-package)
7. [Test Suite Sync](#test-suite-sync)
8. [Type-Specific Normalization Rules](#type-specific-normalization-rules)
9. [Sync Procedures](#sync-procedures)
10. [Edge Cases](#edge-cases)
11. [Troubleshooting](#troubleshooting)

---

## Upstream Sources

### purl-spec Repository

**URL:** https://github.com/package-url/purl-spec

**Key files to monitor:**

| File | Purpose |
|------|---------|
| `PURL-SPECIFICATION.rst` | Core PURL grammar and rules |
| `PURL-TYPES.rst` | Type definitions and normalization rules |
| `test-suite-data.json` | Official compliance test suite |
| `CONTRIBUTING.md` | Contribution and type registration process |

**Fetching spec content:**

```bash
# Core specification
gh api repos/package-url/purl-spec/contents/PURL-SPECIFICATION.rst --jq '.content' | base64 -d

# Type definitions
gh api repos/package-url/purl-spec/contents/PURL-TYPES.rst --jq '.content' | base64 -d

# Test suite
gh api repos/package-url/purl-spec/contents/test-suite-data.json --jq '.content' | base64 -d
```

### vers-spec Repository

**URL:** https://github.com/package-url/vers-spec

**Key files:**

| File | Purpose |
|------|---------|
| `VERSION-RANGE-SPEC.rst` | Version range specification |
| `specification.md` | Updated specification format |
| `tests.md` | Test overview and cases |

**Fetching:**

```bash
gh api repos/package-url/vers-spec/contents/VERSION-RANGE-SPEC.rst --jq '.content' | base64 -d
```

### TC54/ECMA-427

**URL:** https://tc54.org/purl/

**Standard:** ECMA-427, Edition 1st (published December 10, 2025)

**What to check:**
- New editions or errata
- TC54-TG2 meeting notes for upcoming changes
- Ratified amendments

### purl npm Package

**URL:** https://www.npmjs.com/package/purl
**Repository:** https://github.com/ljharb/purl
**Author:** Jordan Harband

**What to check:**
- New version releases and changelogs
- API additions (functions, methods)
- Type support changes
- Registry validation additions

```bash
# Check latest version and info
npm view purl version description repository.url

# Check recent versions
npm view purl versions --json | tail -10
```

---

## PURL Type Registry

### Currently Implemented Types (41)

```
alpm, apk, bazel, bitbucket, bitnami, cargo, cocoapods, composer, conan,
conda, cpan, cran, deb, docker, gem, generic, github, gitlab, golang,
hackage, hex, huggingface, julia, luarocks, maven, mlflow, npm, nuget,
oci, opam, otp, pub, pypi, qpkg, rpm, socket, swid, swift, unknown,
vscode-extension, yocto
```

### Type Handler Location

Each type has a handler at `src/purl-types/{type}.ts` implementing:
- Normalization rules (case, separators)
- Validation rules (required components, constraints)
- Registry existence checking

### Checking for New Types

```bash
# Fetch PURL-TYPES.rst and extract type names
gh api repos/package-url/purl-spec/contents/PURL-TYPES.rst --jq '.content' | base64 -d | grep -oP '(?<=^\*\*)\w+(?=\*\*)' | sort

# Compare with implemented types
ls src/purl-types/ | sed 's/\.ts$//' | sort

# Diff
diff <(gh api repos/package-url/purl-spec/contents/PURL-TYPES.rst --jq '.content' | base64 -d | grep -oP '(?<=^\*\*)\w+(?=\*\*)' | sort) <(ls src/purl-types/ | sed 's/\.ts$//' | sort)
```

### Adding a New Type

1. Create `src/purl-types/{type}.ts` following existing type patterns
2. Register in `src/purl-type.ts` type map
3. Add test data in `test/data/types/{type}.json`
4. Add type-specific tests if needed
5. Update `docs/types.md`

---

## Specification Components

### PURL Grammar (from PURL-SPECIFICATION.rst)

```
scheme:type/namespace/name@version?qualifiers#subpath
```

| Component | Required | Rules |
|-----------|----------|-------|
| scheme | Yes | Always `pkg` |
| type | Yes | Lowercase, no encoding |
| namespace | No | Type-specific case rules |
| name | Yes | Type-specific case rules |
| version | No | Type-specific encoding |
| qualifiers | No | Key=value pairs, sorted |
| subpath | No | Path segments, no leading/trailing `/` |

### Known Qualifier Names

From `src/purl-qualifier-names.ts`:

| Qualifier | Purpose |
|-----------|---------|
| `repository_url` | Alternative repository URL |
| `download_url` | Direct download URL |
| `vcs_url` | Version control URL |
| `file_name` | File name |
| `checksum` | Integrity checksum |

### Encoding Rules

- Type: never encoded, always lowercase
- Namespace/Name: percent-encoded per RFC 3986, type-specific case
- Version: percent-encoded
- Qualifiers: keys lowercase, values percent-encoded
- Subpath: percent-encoded path segments

---

## VERS Specification

### Overview

VERS (Version Range Specification) defines a portable syntax for version ranges across package ecosystems.

**Format:** `vers:{versioning_scheme}/{version_constraints}`

**Version constraints:** Comparator + version pairs separated by `|`

**Comparators:** `<`, `<=`, `>`, `>=`, `=`, `!=`

### Implementation Status

VERS is **not yet implemented** in socket-packageurl-js. When implementing:

1. Create `src/vers.ts` for version range parsing
2. Add VERS support to the `version` component
3. Implement ecosystem-specific version comparison
4. Add test data from vers-spec test suite

### Key Considerations

- VERS uses the PURL type to determine versioning scheme
- Each ecosystem has different version ordering rules
- VERS constraints must be normalized (sorted, deduplicated)

---

## TC54/ECMA-427 Standard

### Current Status

- **Standard:** ECMA-427, Edition 1st
- **Published:** December 10, 2025
- **Developed by:** TC54-TG2 (PURL Community + Ecma International)

### What Differs from purl-spec

ECMA-427 formalizes the purl-spec with:
- Formal grammar definitions
- Normative encoding requirements
- Standardized error handling
- Interoperability requirements

### Monitoring for Updates

```bash
# Check TC54 website for updates
# WebFetch https://tc54.org/purl/ for latest standard status
```

Key events to watch:
- TC54-TG2 meetings (regular cadence)
- PURL Community meetings
- New ECMA-427 editions

---

## purl npm Package

### Overview

The `purl` npm package (by Jordan Harband) is a reference implementation worth monitoring for:
- New API patterns we should consider
- Type support additions
- Normalization behavior differences
- Registry validation approaches

### Current API Surface

```typescript
// Key functions
parse(purlString)      // Parse PURL string
stringify(purlObject)  // Serialize to string
normalize(purl)        // Normalize PURL
validate(purl)         // Validate PURL
eq(a, b)               // Equality comparison
compare(a, b)          // Ordering comparison

// Component accessors
type, namespace, name, version, qualifiers, subpath

// Registry features
registryUrl(purl)      // Generate registry URL
exists(purl)           // Check registry existence
```

### Comparison Points

When syncing, compare:
- Which types does `purl` support that we don't?
- Do normalization behaviors differ?
- Are there new qualifier conventions?
- Has registry URL generation changed?

---

## Test Suite Sync

### Official Test Suite

**Source:** `purl-spec/test-suite-data.json`
**Local copy:** `test/data/spec/specification-test.json`

**Structure:**
```json
[
  {
    "description": "test description",
    "purl": "pkg:type/namespace/name@version",
    "canonical_purl": "pkg:type/namespace/name@version",
    "type": "type",
    "namespace": "namespace",
    "name": "name",
    "version": "version",
    "qualifiers": { "key": "value" },
    "subpath": "subpath",
    "is_invalid": false
  }
]
```

### Sync Procedure

```bash
# 1. Fetch latest test suite
gh api repos/package-url/purl-spec/contents/test-suite-data.json --jq '.content' | base64 -d > /tmp/purl-spec-tests.json

# 2. Compare
diff <(python3 -m json.tool test/data/spec/specification-test.json) <(python3 -m json.tool /tmp/purl-spec-tests.json)

# 3. If changes, copy and validate
cp /tmp/purl-spec-tests.json test/data/spec/specification-test.json
pnpm test
```

### Community Tests

**Local copy:** `test/data/contrib-tests.json`

These are additional tests beyond the official suite. They are maintained locally and should not be overwritten by upstream sync.

### Type-Specific Test Data

**Location:** `test/data/types/{type}.json` (35 files)

These contain ecosystem-specific edge cases. Update when:
- A new type is added
- Type normalization rules change
- New edge cases are discovered

---

## Type-Specific Normalization Rules

### Case Normalization by Type

| Type | Namespace | Name | Notes |
|------|-----------|------|-------|
| npm | as-is | lowercase (adaptive) | Legacy names preserve case |
| pypi | N/A | lowercase, `-` → `-` | PEP 503 normalization |
| maven | as-is | as-is | Case-sensitive |
| golang | lowercase | lowercase | Per Go module spec |
| github | lowercase | lowercase | GitHub is case-insensitive |
| gitlab | lowercase | lowercase | GitLab is case-insensitive |
| bitbucket | lowercase | lowercase | Bitbucket is case-insensitive |
| docker/oci | lowercase | lowercase | OCI spec requires lowercase |
| composer | lowercase | lowercase | Packagist normalizes |
| hex | N/A | lowercase | Hex.pm normalizes |
| cargo | N/A | lowercase | Crates.io normalizes |
| nuget | lowercase | lowercase | NuGet is case-insensitive |
| gem | N/A | as-is | RubyGems preserves case |
| deb | N/A | lowercase | Debian convention |
| rpm | as-is | as-is | RPM preserves case |
| cocoapods | N/A | as-is | CocoaPods preserves case |
| swift | as-is | as-is | Swift PM preserves case |
| pub | N/A | lowercase | pub.dev normalizes |
| huggingface | as-is | as-is | HF preserves case |

### Special Validation Rules

- **npm:** Name validated against `validate-npm-package-name`; adaptive lowercasing uses `data/npm/legacy-names.json`
- **golang:** Must have namespace (module path); validated against Go module conventions
- **maven:** Namespace required (groupId); name is artifactId
- **docker/oci:** Default namespace is `library`; default registry is `hub.docker.com`
- **conan:** Channel qualifier handling
- **swift:** Namespace required (scope URL)

---

## Sync Procedures

### Full Sync Checklist

1. **Check purl-spec** for PURL-SPECIFICATION.rst changes
2. **Check purl-spec** for PURL-TYPES.rst changes (new/modified types)
3. **Sync test suite** from purl-spec test-suite-data.json
4. **Check vers-spec** for version range spec changes
5. **Check TC54** for ECMA-427 updates
6. **Check purl npm** for new versions and API changes
7. **Compare type lists** (spec vs implementation)
8. **Run tests** to verify compliance
9. **Report findings** with actionable items

### Commit Convention

```bash
# New type implementation
git commit -m "feat(purl-types): add {type} type handler

Implements {type} type per PURL-TYPES.rst specification.
- [normalization rules]
- [validation rules]
- [test coverage]"

# Test suite sync
git commit -m "chore(tests): sync purl-spec test suite

Updated test/data/spec/specification-test.json from upstream
purl-spec repository."

# Normalization fix
git commit -m "fix({type}): update normalization per spec clarification

{description of what changed in the spec}"
```

---

## Edge Cases

### Type Name Conflicts

Some type names may conflict with TypeScript reserved words or file system conventions. Use the handler naming pattern: `src/purl-types/{type}.ts` with appropriate exports.

### Spec Ambiguity

When the spec is ambiguous:
1. Check TC54/ECMA-427 for formal definition
2. Check purl npm package behavior
3. Check other reference implementations
4. Document the ambiguity and chosen behavior
5. Add edge case tests

### Draft vs Ratified Types

- Only implement types that appear in the ratified PURL-TYPES.rst
- Draft types (in PRs or design docs) require user confirmation
- The `unknown` type handler catches unrecognized types gracefully

### Breaking Spec Changes

If a spec change would break existing behavior:
1. Flag to user with specific impact analysis
2. Check if TC54/ECMA-427 supersedes
3. Consider a major version bump if behavior changes
4. Update docs and changelog

---

## Troubleshooting

### GitHub API Rate Limiting

**Symptom:** `gh api` calls return 403 or rate limit errors.

**Solution:**
```bash
# Check rate limit
gh api rate_limit --jq '.rate'

# Use authenticated requests (gh is usually authenticated)
gh auth status
```

### Test Suite Format Changes

**Symptom:** Test suite JSON structure has changed.

**Solution:**
1. Check the test suite JSON schema: `https://packageurl.org/schemas/purl-test.schema-1.0.json`
2. Update test runner in `test/purl-spec.test.mts` to handle new fields
3. Ensure backward compatibility with existing test data

### base64 Decoding Issues

**Symptom:** `base64 -d` fails on macOS.

**Solution:** macOS uses `base64 -D` (capital D) or `base64 --decode`:
```bash
gh api repos/package-url/purl-spec/contents/test-suite-data.json --jq '.content' | base64 --decode
```

### Spec File Exceeds GitHub API Size Limit

**Symptom:** Large files return truncated content via contents API.

**Solution:** Use raw content URL:
```bash
curl -sL "https://raw.githubusercontent.com/package-url/purl-spec/main/PURL-TYPES.rst"
```
