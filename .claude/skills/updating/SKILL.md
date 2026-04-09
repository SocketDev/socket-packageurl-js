---
name: updating
description: Coordinates all dependency updates (npm packages, upstream spec sync, and purl package feature parity). Triggers when user asks to "update everything", "update dependencies", or prepare for a release.
user-invocable: true
allowed-tools: Task, Skill, Bash, Read, Grep, Glob, Edit
---

# updating

<task>
Update all dependencies in socket-packageurl-js: npm packages via `pnpm run update`, then sync upstream specs and check feature parity with the purl npm package, ensuring all builds and tests pass.
</task>

<context>
**What is this?**
This skill coordinates all update targets for socket-packageurl-js: npm packages, upstream spec compliance, and feature parity with the purl npm package.

**Existing Skills:**
- `updating-spec` - Syncs against purl-spec, vers-spec, TC54/ECMA-427 standards
- `updating-npm-purl-package` - Checks feature parity with the purl npm package (URL types, registry validation, normalization)

**Update Targets:**
1. **npm packages** - Updated via `pnpm run update`
2. **Upstream specs** - Updated via `updating-spec` skill
3. **purl npm feature parity** - Updated via `updating-npm-purl-package` skill
</context>

<constraints>
**Requirements:**
- Start with clean working directory (no uncommitted changes)

**CI Mode** (detected via `CI=true` or `GITHUB_ACTIONS`):
- Create atomic commits, skip build validation (CI validates separately)
- Workflow handles push and PR creation

**Interactive Mode** (default):
- Validate updates with build/tests before proceeding
- Report validation results to user

**Actions:**
- Update npm packages
- Create atomic commits
- Report summary of changes
</constraints>

<instructions>

## Process

### Phase 1: Validate Environment

<action>
Check working directory is clean and detect CI mode:
</action>

```bash
# Detect CI mode
if [ "$CI" = "true" ] || [ -n "$GITHUB_ACTIONS" ]; then
  CI_MODE=true
  echo "Running in CI mode - will skip build validation"
else
  CI_MODE=false
  echo "Running in interactive mode - will validate builds"
fi

# Check working directory is clean
git status --porcelain
```

<validation>
- Working directory must be clean
- CI_MODE detected for subsequent phases
</validation>

---

### Phase 2: Update npm Packages

<action>
Run pnpm run update to update npm dependencies:
</action>

```bash
# Update npm packages
pnpm run update

# Check if there are changes
if [ -n "$(git status --porcelain pnpm-lock.yaml package.json)" ]; then
  git add pnpm-lock.yaml package.json
  git commit -m "chore: update npm dependencies

Updated npm packages via pnpm run update."
  echo "npm packages updated"
else
  echo "npm packages already up to date"
fi
```

---

### Phase 3: Sync Upstream Specs

<action>
Use the updating-spec skill to check for purl-spec, vers-spec, and TC54 changes:
</action>

```
Skill({ skill: "updating-spec" })
```

Wait for skill completion before proceeding.

---

### Phase 4: Check purl npm Feature Parity

<action>
Use the updating-npm-purl-package skill to check for feature gaps:
</action>

```
Skill({ skill: "updating-npm-purl-package" })
```

Wait for skill completion before proceeding.

---

### Phase 5: Final Validation

<action>
Run build and test suite (skip in CI mode):
</action>

```bash
if [ "$CI_MODE" = "true" ]; then
  echo "CI mode: Skipping final validation (CI will run builds/tests separately)"
  echo "Commits created - ready for push by CI workflow"
else
  echo "Interactive mode: Running full validation..."
  pnpm run fix --all
  pnpm run check --all
  pnpm test
fi
```

---

### Phase 6: Report Summary

<action>
Generate update report:
</action>

```
## Update Complete

### Updates Applied:

| Category | Status |
|----------|--------|
| npm packages | Updated/Up to date |
| Upstream specs | Synced/No changes |
| purl npm parity | Synced/No changes |

### Commits Created:
- [list commits if any]

### Validation:
- Build: SUCCESS/SKIPPED (CI mode)
- Tests: PASS/SKIPPED (CI mode)

### Next Steps:
**Interactive mode:**
1. Review changes: `git log --oneline -N`
2. Push to remote: `git push origin main`

**CI mode:**
1. Workflow will push branch and create PR
2. CI will run full build/test validation
3. Review PR when CI passes
```

</instructions>

## Success Criteria

- All npm packages checked for updates
- Upstream specs synced (purl-spec, vers-spec, TC54)
- Feature parity checked against purl npm package
- Full build and tests pass (interactive mode)
- Comprehensive summary report generated

## Context

This skill is useful for:

- Weekly maintenance (automated via weekly-update.yml)
- Security patch rollout
- Pre-release preparation

**Safety:** Updates are validated before committing. Failures stop the process.

**Skills Used:**
- `updating-spec` - Upstream spec sync
- `updating-npm-purl-package` - Feature parity with purl npm package
