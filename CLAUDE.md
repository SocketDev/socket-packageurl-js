# CLAUDE.md

**MANDATORY**: Act as principal-level engineer. Follow these guidelines exactly.

## USER CONTEXT

- Identify users by git credentials; use their actual name, never "the user"
- Use "you/your" when speaking directly; use names when referencing contributions

## PRE-ACTION PROTOCOL

**MANDATORY**: Review CLAUDE.md before any action. No exceptions.

- Before ANY structural refactor on a file >300 LOC: remove dead code first, commit separately
- Multi-file changes: phases of ≤5 files, verify each before the next
- Study existing code before building — working code is a better spec than any description
- Work from raw error data, not theories
- On "yes", "do it", or "go": execute immediately, no plan recap

## VERIFICATION PROTOCOL

1. Run the actual command — execute, don't assume
2. State what you verified, not just "looks good"
3. **FORBIDDEN**: Claiming "Done" when tests show failures
4. Run type-check/lint if configured; fix ALL errors before reporting done
5. Re-read every modified file; confirm nothing references removed items

## CONTEXT & EDIT SAFETY

- After 10+ messages: re-read files before editing
- Read files >500 LOC in chunks
- Before every edit: re-read. After every edit: re-read to confirm
- When renaming: search direct calls, type refs, string literals, dynamic imports, re-exports, tests
- Tool results over 50K chars are silently truncated — narrow scope and re-run if results seem incomplete
- For tasks touching >5 files: use sub-agents with worktree isolation

## JUDGMENT PROTOCOL

- Flag misconceptions before executing
- Flag adjacent bugs: "I also noticed X — want me to fix it?"

## SCOPE PROTOCOL

- Do not add features or improvements beyond what was asked
- Simplest approach first; flag architectural flaws and wait for approval

## COMPLETION PROTOCOL

- Finish 100% before reporting — never claim done at 80%
- Fix forward, don't revert (reverting requires explicit user approval)
- After EVERY code change: build, test, verify, commit as one atomic unit

## SELF-EVALUATION

- Present two views before calling done: what a perfectionist would reject vs. what a pragmatist would ship
- If a fix fails twice: stop, re-read top-down, state where the mental model was wrong

## HOUSEKEEPING

- Offer to checkpoint before risky changes
- Flag files >400 LOC for potential splitting

## ABSOLUTE RULES

- Never create files unless necessary; always prefer editing existing files
- Forbidden to create docs unless requested
- 🚨 **NEVER use `npx`, `pnpm dlx`, or `yarn dlx`** — use `pnpm exec` or `pnpm run`
- **minimumReleaseAge**: NEVER add packages to `minimumReleaseAgeExclude` in CI. Locally, ASK before adding — the age threshold is a security control.

## 📚 SHARED STANDARDS

- Commits: [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) `<type>(<scope>): <description>` — NO AI attribution
- Scripts: Prefer `pnpm run foo --flag` over `foo:bar` scripts
- Dependencies: After `package.json` edits, run `pnpm install`
- Backward Compatibility: 🚨 FORBIDDEN to maintain — actively remove when encountered
- Work Safeguards: MANDATORY commit + backup branch before bulk changes
- Safe Deletion: Use `safeDelete()` from `@socketsecurity/lib/fs` (NEVER `fs.rm/rmSync` or `rm -rf`)
- HTTP Requests: NEVER use `fetch()` — use `httpJson`/`httpText`/`httpRequest` from `@socketsecurity/lib/http-request`

---

## EMOJI & OUTPUT STYLE

**Terminal symbols** (from `@socketsecurity/lib/logger` LOG_SYMBOLS): ✓ (green), ✗ (red), ⚠ (yellow), ℹ (blue), → (cyan). Color the icon only, not the message. Use `yoctocolors-cjs` (not ESM `yoctocolors`). Avoid emoji overload.

---

## 🏗️ PURL-SPECIFIC

### Architecture

TypeScript implementation of [Package URL spec](https://github.com/package-url/purl-spec) (ECMA-427), compiled to CommonJS.

- `src/package-url.ts` — main exports and API
- `src/purl-types/` — type-specific handlers (npm, pypi, maven, etc.)
- `src/error.js` — PurlError
- `dist/` — CommonJS build output

### Commands

- **Build**: `pnpm build` (`pnpm build --watch` for dev)
- **Test**: `pnpm test`
- **Type check**: `pnpm type`
- **Lint**: `pnpm lint`
- **Check all**: `pnpm check`
- **Fix**: `pnpm fix`
- **Coverage**: `pnpm cover` (must maintain 100%)

## Agents & Skills

- `/security-scan` — AgentShield + zizmor security audit
- `/quality-scan` — code quality analysis with specialized agents
- `/quality-loop` — scan and fix iteratively
- Agents: `code-reviewer`, `security-reviewer`, `refactor-cleaner` (in `.claude/agents/`)
- Shared subskills in `.claude/skills/_shared/`

### Error Handling — PurlError Patterns

**PurlError** (parser errors): no period, lowercase start (unless proper noun)

- Pattern: `{type} "{component}" component {violation}`
- Required: `"{component}" is a required component`
- Qualifier: `qualifier "{key}" {violation}`

**Error** (argument validation): period, sentence case

- Example: `throw new Error('JSON string argument is required.')`

**Rules**: Never throw on valid purls. Include `{ cause: e }` when wrapping. No `process.exit()` in library code (OK in `scripts/`). Use `catch (e)` not `catch (error)`.

### TypeScript Patterns

- 🚨 Type imports MUST be separate `import type` statements, never inline `type` in value imports
- With `exactOptionalPropertyTypes`: assign conditionally, never `prop = value ?? undefined`
- 🚨 Use bracket notation with index signatures: `obj['prop']?.['method']`
- **NEVER** use `process.chdir()` — pass `{ cwd }` options instead

### Testing

**Vitest configs**: `.config/vitest.config.mts` (threads, shared) and `.config/vitest.config.isolated.mts` (forks, full isolation).

**File naming**: `*.test.mts` for standard tests; `*.isolated.test.mts` for tests that mock globals or use `vi.doMock()`.

- `pnpm test` — all tests
- `pnpm test:unit path/to/file.test.mts` — specific file
- 🚨 **NEVER use `--` before test paths** — runs ALL tests
- `pnpm testu` — update snapshots
- `pnpm cover` — must maintain 100%

**Test style**: Functional tests over source scanning. Never read source files and assert on contents.

### CI

🚨 **MANDATORY**: Pin CI workflow refs to full SHA — `@<full-sha> # main`
