---
name: quality-scan
description: Performs comprehensive quality scans across PURL library codebase to identify critical bugs, logic errors, spec violations, and workflow problems. Spawns specialized agents for targeted analysis and generates prioritized improvement tasks. Use when improving code quality, before releases, or investigating issues.
---

# quality-scan

## Role

Code Quality Auditor specializing in systematic vulnerability detection and quality improvement across TypeScript PURL (Package URL) library.

## Action

Execute comprehensive quality scans using specialized agents to identify critical bugs, logic errors, spec violations, and workflow problems. Generate prioritized task list for improvements.

## Limitations

**Constraints:**
- Read-only analysis (no code changes during scan)
- Must complete all enabled scans before reporting
- Findings must be prioritized by severity
- Must generate actionable tasks with file:line references

**Do NOT:**
- Fix issues during scan (analysis only)
- Skip critical scan types without user permission
- Report findings without file/line references
- Proceed if codebase has uncommitted changes (warn but continue)

**Do ONLY:**
- Run enabled scan types in priority order
- Generate structured findings with severity levels
- Provide actionable improvement tasks
- Report statistics and coverage metrics

## Process

### Phase 1: Validate Environment

```bash
git status
```

**Requirements:**
- Working directory should be clean (warn if dirty but continue)
- On a valid branch
- Node modules installed

**If fails:** Warn user but continue with scan.

---

### Phase 2: Determine Scan Scope

**Default Scan Types** (run all unless user specifies):
1. **critical** - Critical bugs (crashes, security, resource leaks)
2. **logic** - Logic errors (algorithms, edge cases, type guards)
3. **spec** - PURL spec compliance violations
4. **workflow** - Workflow problems (scripts, CI, git hooks)

**Ask user:** "Run all scans or specific types? (default: all)"

If user specifies types, validate they exist and run only those.

---

### Phase 3: Execute Scans

For each enabled scan type, spawn a specialized agent using Task tool:

```typescript
// Example: Critical scan
Task({
  subagent_type: "general-purpose",
  prompt: `${CRITICAL_SCAN_PROMPT}

Focus on src/ directory. Report findings in this format:
- File: path/to/file.ts:lineNumber
- Issue: Brief description
- Severity: Critical/High/Medium/Low
- Fix: Suggested fix

Scan systematically and report all findings.`
})
```

**For each scan:**
1. Load agent prompt from `reference.md`
2. Spawn agent with Task tool
3. Capture findings
4. Parse and categorize results

**Iteration:** Run scans sequentially (critical → logic → spec → workflow)

---

### Phase 4: Aggregate Findings

Collect all findings from agents and aggregate:

```typescript
interface Finding {
  file: string           // "src/package-url.ts:89"
  issue: string          // "Potential null pointer access"
  severity: "Critical" | "High" | "Medium" | "Low"
  scanType: string       // "critical"
  suggestion: string     // "Add optional chaining: obj?.prop"
}
```

**Deduplication:** Remove duplicate findings across scans

**Prioritization:** Sort by severity (Critical → High → Medium → Low)

---

### Phase 5: Generate Report

Create structured quality report:

```markdown
# Quality Scan Report

**Date:** YYYY-MM-DD
**Scans:** critical, logic, spec, workflow
**Files Scanned:** N
**Findings:** N critical, N high, N medium, N low

## Critical Issues (Priority 1)
- [ ] src/package-url.ts:89 - Potential null pointer access
      Suggestion: Add optional chaining

## High Issues (Priority 2)
...

## Medium Issues (Priority 3)
...

## Low Issues (Priority 4)
...

## Scan Coverage
- Critical scan: N files analyzed
- Logic scan: N files analyzed
- Spec scan: N files analyzed
- Workflow scan: N files analyzed

## Recommendations
1. Address all critical issues immediately
2. Review high-severity logic errors
3. Consider medium issues for next release
```

**Output report to:** Console + optionally save to file

---

### Phase 6: Complete

**Completion Signal:**

```xml
<promise>QUALITY_SCAN_COMPLETE</promise>
```

**Summary:**
- Scans completed: critical, logic, spec, workflow
- Total findings: N
- Critical issues: N
- Files scanned: N
- Report generated: ✓

## Success Criteria

- ✅ `<promise>QUALITY_SCAN_COMPLETE</promise>` output
- ✅ All enabled scans completed
- ✅ Findings prioritized by severity
- ✅ Report includes file:line references
- ✅ Actionable suggestions provided
- ✅ No errors during scan execution

## Scan Types

See `reference.md` for detailed agent prompts:

- **critical-scan** - Null access, promise rejections, race conditions, type coercion
- **logic-scan** - Off-by-one errors, type guards, edge cases, algorithm correctness
- **spec-scan** - PURL spec violations, normalization errors, encoding issues
- **workflow-scan** - Scripts, package.json, git hooks, CI configuration

## Commands

This skill is self-contained. No external commands needed.

## Context

This skill provides systematic quality scanning for the socket-packageurl-js library by:
- Embedding agent prompts in reference.md
- Using Task tool to spawn agents directly
- Generating reports without separate scripts
- Focusing on PURL specification compliance

For detailed agent prompts, scan patterns, and examples, see `reference.md`.
