---
name: quality-scan
description: Validates structural consistency, cleans up junk files (SCREAMING_TEXT.md, temp files), and performs comprehensive quality scans across codebase to identify critical bugs, logic errors, caching issues, and workflow problems. Spawns specialized agents for targeted analysis and generates prioritized improvement tasks. Use when improving code quality, before releases, or investigating issues.
---

# quality-scan

<task>
Perform comprehensive quality scans across the codebase using specialized agents to identify critical bugs, logic errors, caching issues, and workflow problems. Before scanning, clean up junk files (SCREAMING_TEXT.md files, temporary test files, etc.) to ensure a clean repository. Generate a prioritized report with actionable improvement tasks.
</task>

<constraints>
**CRITICAL Requirements:**
- Read-only analysis (no code changes during scan)
- Must complete all enabled scans before reporting
- Findings must be prioritized by severity (Critical > High > Medium > Low)
- Must generate actionable tasks with file:line references
- All findings must include suggested fixes

**Do NOT:**
- Fix issues during scan (analysis only, report findings)
- Skip critical scan types without user permission
- Report findings without file/line references

**Do ONLY:**
- Run enabled scan types in priority order (critical > logic > cache > workflow)
- Generate structured findings with severity levels
- Provide actionable improvement tasks with specific code changes
- Report statistics and coverage metrics
- Deduplicate findings across scans
</constraints>

<instructions>

## Process

### Phase 1: Validate Environment

Run `git status`. Working directory should be clean (warn if dirty but continue). Confirm on a valid branch with node modules installed.

---

### Phase 2: Update Dependencies

Run `pnpm run update` for the current repository only. Report number of packages updated. Continue with scan even if update fails.

---

### Phase 3: Repository Cleanup

Clean up junk files before scanning:

1. **SCREAMING_TEXT.md files** (all-caps .md files) NOT inside `.claude/` or `docs/`, and NOT named `README.md`, `LICENSE`, or `SECURITY.md`
2. **Misplaced test files** (`.test.mjs`/`.test.mts` outside `test/` or `__tests__/`)
3. **Temp files** (`*.tmp`, `*.temp`, `.DS_Store`, `Thumbs.db`, `*~`, `*.swp`, `*.swo`, `*.bak`)
4. **Stray log files** (`*.log` in root or source directories, not in `logs/` or `build/`)

For each file found: show the path, explain why it is junk, get user confirmation before deleting. Use `git rm` if tracked, `rm` if untracked.

---

### Phase 4: Structural Validation

Run `node scripts/check-consistency.mjs` if it exists. Report errors as Critical findings. Warnings are Low findings. Continue with remaining scans regardless.

---

### Phase 5: Determine Scan Scope

Ask the user which scans to run. Default is all scan types.

**Scan types:**
1. **critical** - Crashes, security vulnerabilities, resource leaks, data corruption
2. **logic** - Algorithm errors, edge cases, type guards, off-by-one errors
3. **cache** - Cache staleness, race conditions, invalidation bugs
4. **workflow** - Build scripts, CI issues, cross-platform compatibility
5. **workflow-optimization** - CI optimization checks (build-required conditions on cached builds)
6. **security** - GitHub Actions workflow security (zizmor scanner)
7. **documentation** - README accuracy, outdated docs, missing documentation

---

### Phase 6: Execute Scans

For each enabled scan type, spawn a specialized agent via Task tool (subagent_type: "general-purpose"). Load the agent prompt template from `reference.md`, customize for repository context, and capture findings.

Run scans sequentially in priority order: critical > logic > cache > workflow > workflow-optimization > security > documentation.

Each finding must include: file path with line number, issue description, severity, code pattern, trigger, suggested fix, and impact.

---

### Phase 7: Aggregate Findings

Collect all findings. Deduplicate (same file:line and issue across scans, keeping the highest-priority scan's version). Sort by severity descending, then by scan type priority, then alphabetically by file path.

---

### Phase 8: Generate Report

Generate a structured report using the "Report Template" section in `reference.md`. The report must include: scan metadata, dependency update status, structural validation results, findings grouped by severity, scan coverage statistics, and prioritized recommendations.

Display report to console and offer to save to `reports/quality-scan-YYYY-MM-DD.md`.

---

### Phase 9: Complete

<completion_signal>
```xml
<promise>QUALITY_SCAN_COMPLETE</promise>
```
</completion_signal>

Report final metrics: dependency update count, structural validation results, cleanup count, scans completed, total findings by severity, files scanned, and scan duration. See `reference.md` section "Completion Summary" for the full template.

</instructions>

## Success Criteria

- `<promise>QUALITY_SCAN_COMPLETE</promise>` output
- All enabled scans completed without errors
- Findings prioritized by severity (Critical > Low)
- All findings include file:line references and suggested fixes
- Report generated with statistics and coverage metrics
- Duplicate findings removed

## Scan Types

See `reference.md` for detailed agent prompts:

- **critical-scan** - Null access, promise rejections, race conditions, resource leaks
- **logic-scan** - Off-by-one errors, type guards, edge cases, algorithm correctness
- **cache-scan** - Invalidation, key generation, memory management, concurrency
- **workflow-scan** - Scripts, package.json, git hooks, CI configuration
- **workflow-optimization-scan** - CI optimization checks (build-required on cached builds)
- **security-scan** - GitHub Actions workflow security (runs zizmor scanner)
- **documentation-scan** - README accuracy, outdated examples, missing documentation
