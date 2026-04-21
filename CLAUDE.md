# CLAUDE.md

**MANDATORY**: Act as principal-level engineer. Follow these guidelines exactly.

## USER CONTEXT

- Identify users by git credentials; use their actual name, never "the user"
- Use "you/your" when speaking directly; use names when referencing contributions

## PARALLEL CLAUDE SESSIONS - WORKTREE REQUIRED

**This repo may have multiple Claude sessions running concurrently against the same checkout, against parallel git worktrees, or against sibling clones.** Several common git operations are hostile to that and silently destroy or hijack the other session's work.

- **FORBIDDEN in the primary checkout** (the one another Claude may be editing):
  - `git stash` — shared stash store; another session can `pop` yours.
  - `git add -A` / `git add .` — sweeps files belonging to other sessions.
  - `git checkout <branch>` / `git switch <branch>` — yanks the working tree out from under another session.
  - `git reset --hard` against a non-HEAD ref — discards another session's commits.
- **REQUIRED for branch work**: spawn a worktree instead of switching branches in place. Each worktree has its own HEAD, so branch operations inside it are safe.

  ```bash
  # From the primary checkout — does NOT touch the working tree here.
  git worktree add -b <task-branch> ../<repo>-<task> main
  cd ../<repo>-<task>
  # edit, commit, push from here; the primary checkout is untouched.
  cd -
  git worktree remove ../<repo>-<task>
  ```

- **REQUIRED for staging**: surgical `git add <specific-file> [<file>…]` with explicit paths. Never `-A` / `.`.
- **If you need a quick WIP save**: commit on a new branch from inside a worktree, not a stash.

The umbrella rule: never run a git command that mutates state belonging to a path other than the file you just edited.

## PRE-ACTION PROTOCOL

**MANDATORY**: Review CLAUDE.md before any action. No exceptions.

- Before ANY structural refactor on a file >300 LOC: remove dead code first, commit separately
- Multi-file changes: phases of ≤5 files, verify each before the next
- Study existing code before building
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
- Tool results over 50K chars are silently truncated — narrow scope and re-run if incomplete
- For tasks touching >5 files: use sub-agents with worktree isolation

## JUDGMENT PROTOCOL

- If the user's request is based on a misconception, say so before executing
- If you spot a bug adjacent to what was asked, flag it: "I also noticed X — want me to fix it?"
- You are a collaborator, not just an executor
- Fix warnings when you find them (lint, type-check, build, runtime) — don't leave them for later
- **Default to perfectionist mindset**: when you have latitude to choose, pick the maximally correct option — no shortcuts, no cosmetic deferrals. Fix state that _looks_ stale even if not load-bearing. If pragmatism is the right call, the user will ask for it explicitly. "Works now" ≠ "right."

## SCOPE PROTOCOL

- Do not add features or improvements beyond what was asked
- Simplest approach first; flag architectural flaws and wait for approval

## COMPLETION PROTOCOL

- Finish 100% before reporting — never claim done at 80%
- Fix forward, don't revert (reverting requires explicit user approval)
- After EVERY code change: build, test, verify, commit as one atomic unit

## SELF-EVALUATION

- Present two views before calling done: what a perfectionist would reject vs. what a pragmatist would ship — and let the user decide. If the user gives no signal, default to perfectionist: do the fuller fix.
- If a fix fails twice: stop, re-read top-down, state where the mental model was wrong

## HOUSEKEEPING

- Offer to checkpoint before risky changes
- Flag files >400 LOC for potential splitting

## ABSOLUTE RULES

- Never create files unless necessary; always prefer editing existing files
- Forbidden to create docs unless requested
- 🚨 **NEVER use `npx`, `pnpm dlx`, or `yarn dlx`** — use `pnpm exec` or `pnpm run` <!-- # zizmor: docs mention forbidden tools intentionally -->

- **minimumReleaseAge**: NEVER add packages to `minimumReleaseAgeExclude` in CI. Locally, ASK before adding — the age threshold is a security control.

## 📚 SHARED STANDARDS

- Commits: [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) `<type>(<scope>): <description>` — NO AI attribution
- Scripts: Prefer `pnpm run foo --flag` over `foo:bar` variants
- Dependencies: After `package.json` edits, run `pnpm install`
- Backward Compatibility: 🚨 FORBIDDEN to maintain — actively remove when encountered
- Work Safeguards: MANDATORY commit + backup branch before bulk changes
- Safe Deletion: Use `safeDelete()` from `@socketsecurity/lib/fs` (NEVER `fs.rm/rmSync` or `rm -rf`)
- HTTP Requests: NEVER use `fetch()` — use `httpJson`/`httpText`/`httpRequest` from `@socketsecurity/lib/http-request`
- File existence: ALWAYS `existsSync` from `node:fs`. NEVER `fs.access`, `fs.stat`-for-existence, or an async `fileExists` wrapper. Import form: `import { existsSync, promises as fs } from 'node:fs'`.

## EMOJI & OUTPUT STYLE

Terminal symbols (from `@socketsecurity/lib/logger` LOG_SYMBOLS): ✓ (green), ✗ (red), ⚠ (yellow), ℹ (blue), → (cyan). Color the icon only. Use `yoctocolors-cjs` (not ESM `yoctocolors`). Avoid emoji overload.

---

## 🏗️ PURL-SPECIFIC

### Architecture

TypeScript implementation of [Package URL spec](https://github.com/package-url/purl-spec) (ECMA-427), compiled to CommonJS.

- `src/package-url.ts` — main exports and API
- `src/purl-types/` — type-specific handlers (npm, pypi, maven, etc.)
- `src/error.js` — PurlError
- `dist/` — CommonJS build output

### Commands

- Build: `pnpm build` (`pnpm build --watch` for dev)
- Test: `pnpm test` (specific file: `pnpm test:unit path/to/file.test.mts`)
- Type check: `pnpm type`
- Lint: `pnpm lint`
- Check all: `pnpm check`
- Fix: `pnpm fix`
- Coverage: `pnpm cover` (must maintain 100%)
- Update snapshots: `pnpm testu`

### Agents & Skills

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

Vitest configs: `.config/vitest.config.mts` (threads, shared) and `.config/vitest.config.isolated.mts` (forks, full isolation).

File naming: `*.test.mts` for standard tests; `*.isolated.test.mts` for tests that mock globals or use `vi.doMock()`.

- 🚨 **NEVER use `--` before test paths** — runs ALL tests
- Test style: functional tests over source scanning. Never read source files and assert on contents.

### CI

🚨 **MANDATORY**: Pin CI workflow refs to full SHA — `@<full-sha> # main`

## TOKEN HYGIENE — NON-NEGOTIABLE

🚨 **Never** emit the raw value of any secret to any tool output, commit message, comment, or assistant response. A Bash PreToolUse hook at `.claude/hooks/token-hygiene/` enforces this programmatically — `env`/`printenv`/`cat .env*`/`curl -H Authorization` patterns without a redaction pipeline are refused before the tool runs.

**Enforcement rules** the hook encodes (applies to Bash tool calls):

1. Never run `env`, `printenv`, `export -p`, or `set` (no args) — they print everything.
2. Never `cat`/`head`/`tail`/`less`/`more` a `.env*` file without piping through a redactor (`sed 's/=.*/=<redacted>/'` or similar). If you only need the keys, use `grep -v '^#' .env.local | cut -d= -f1`.
3. Never run a `curl` that carries `-H "Authorization: ..."` with output going to unfiltered stdout. Either redirect to `/dev/null`, save to a file, or pipe to `jq`/`grep`/`head`.
4. Never construct a command that references a sensitive env var name (`*TOKEN*`, `*SECRET*`, `*PASSWORD*`, `*API_KEY*`, `*SIGNING_KEY*`, `*PRIVATE_KEY*`, `*AUTH*`, `*CREDENTIAL*`) and writes to stdout without a redaction step — unless the command is a legitimate git/pnpm/npm/node/tsc operation that only surfaces names.

**If the hook blocks you**, the stderr output explains why and suggests a fix. Rewrite the command; don't bypass the hook.

**Behavioral rules** (things the hook can't catch):

- When citing an API response, redact any `token`, `jwt`, `access_token`, `refresh_token`, `api_key`, `secret`, `password`, `authorization` field to `<redacted>` before including in your reply.
- When showing `.env.local` or similar, show **key names only** — never values.
- If a user pastes a secret to you, treat the session's copy as compromised and ask them to rotate it. Never re-echo it.
- Prefer reading env values into subprocesses via `{ env: { ... } }` spawn options over `export FOO=bar && ...` chains, so the value never appears in the Bash tool's command string.
