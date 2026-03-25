# updating Reference Documentation

This document provides detailed information about dependency update procedures, npm data synchronization, and troubleshooting for the updating skill.

## Table of Contents

1. [Update Targets](#update-targets)
2. [npm Dependency Updates](#npm-dependency-updates)
3. [npm Data Synchronization](#npm-data-synchronization)
4. [Sub-Skills](#sub-skills)
5. [Validation](#validation)
6. [Troubleshooting](#troubleshooting)

---

## Update Targets

### npm Packages

Updated via `pnpm run update` which runs `scripts/update.mjs`:

- Uses **taze** for dependency version detection (recursive, write mode)
- Force-updates Socket packages bypassing taze maturity period:
  - `@socketsecurity/*`
  - `@socketregistry/*`
  - `@socketbin/*`
- Installs updated packages via `pnpm install`

### npm Validation Data

Updated via `pnpm run update:data:npm` which runs `scripts/update-data-npm.mjs`:

- **builtin-names.json** - Node.js builtin module names (requires Node >= next maintained version)
- **legacy-names.json** - Legacy npm package names from `all-the-package-names` datasets

---

## npm Dependency Updates

### How `pnpm run update` Works

```bash
# 1. Run taze recursively with write mode
pnpm exec taze -r -w

# 2. Force-update Socket scoped packages
pnpm update @socketsecurity/* @socketregistry/* @socketbin/* --latest -r

# 3. Install updated packages
pnpm install
```

### Package.json Pinning

All dependencies (dev and direct) are pinned to exact versions. The update script handles bumping these pins to latest.

### After Update

Files that may change:
- `package.json` - Version pins
- `pnpm-lock.yaml` - Lock file

---

## npm Data Synchronization

### builtin-names.json

**Location:** `data/npm/builtin-names.json`

**Source:** `Module.builtinModules` from Node.js runtime

**Requirements:**
- Node.js >= next maintained version (currently requires Node 23+)
- Filters out `node:` prefixed modules without unprefixed equivalents (e.g., `node:sea`, `node:sqlite`, `node:test`)

### legacy-names.json

**Location:** `data/npm/legacy-names.json`

**Sources:**
- `all-the-package-names@2.0.0` (43.1MB names.json)
- `all-the-package-names@1.3905.0` (24.7MB names.json, last v1 release)

**Process:**
1. Combines both name datasets (unique union)
2. Filters out names that are not valid for old packages per `validate-npm-package-name`
3. Filters out names that look like legacy but are actually new-style
4. Verifies package existence via `pacote.manifest()` (3 concurrent, 4 retries)
5. Writes sorted, validated results

**Interactive prompts:** The script prompts for confirmation before each data update phase.

---

## Sub-Skills

The updating skill coordinates two additional skills after npm dependency updates:

### updating-spec

Syncs against upstream PURL and VERS specifications:
- **purl-spec** - Core PURL grammar, type definitions, test suite
- **vers-spec** - Version range specification
- **TC54/ECMA-427** - Formal standard updates

See `updating-spec/reference.md` for detailed spec comparison procedures.

### updating-npm-purl-package

Checks feature parity with the `purl` npm package (https://github.com/ljharb/purl):
- **URL type coverage** - Registry URL generation for each ecosystem
- **Registry validation** - Existence checking support
- **Normalization behavior** - Type-specific encoding and casing rules

See `updating-npm-purl-package/reference.md` for feature comparison matrix.

---

## Validation

### Post-Update Validation

```bash
# Fix lint issues
pnpm run fix

# Run all checks (lint + type check)
pnpm run check

# Run tests
pnpm test
```

### CI Mode

In CI mode (`CI=true` or `GITHUB_ACTIONS` set):
- Skip build validation (CI runs separately)
- Create atomic commits only
- Workflow handles push and PR creation

---

## Troubleshooting

### taze Fails to Detect Updates

**Symptom:** `pnpm run update` reports no changes when updates exist.

**Cause:** taze has a maturity period for new releases.

**Solution:** Socket packages are force-updated separately via `pnpm update --latest`, bypassing taze maturity.

### Node Version Too Low for builtin-names

**Symptom:** `update:data:npm` skips builtin names with version warning.

**Cause:** Script requires Node >= next maintained version for accurate builtin list.

**Solution:** Use Node 23+ (or current "next" version) when running `pnpm run update:data:npm`.

### Legacy Names Verification Timeouts

**Symptom:** `update:data:npm` hangs or times out during package verification.

**Cause:** Network issues or npm registry rate limiting.

**Solution:**
- Check network connectivity
- Retry (script has built-in 4 retries per package)
- Run during off-peak hours

### Lock File Conflicts

**Symptom:** `pnpm install` fails after update.

**Solution:**
```bash
rm pnpm-lock.yaml
pnpm install
```
