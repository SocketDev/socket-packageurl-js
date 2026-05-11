# CLAUDE.md

**MANDATORY**: Act as principal-level engineer. Follow these guidelines exactly.

<!-- BEGIN FLEET-CANONICAL — sync via socket-wheelhouse/scripts/sync-scaffolding.mts. Do not edit downstream. -->

## 📚 Wheelhouse Standards

### Identifying users

Identify users by git credentials and use their actual name. Use "you/your" when speaking directly; use names when referencing contributions.

### Parallel Claude sessions

This repo may have multiple Claude sessions running concurrently against the same checkout, against parallel git worktrees, or against sibling clones. Several common git operations are hostile to that.

**Forbidden in the primary checkout:**

- `git stash` — shared store; another session can `pop` yours
- `git add -A` / `git add .` — sweeps files from other sessions
- `git checkout <branch>` / `git switch <branch>` — yanks the working tree out from under another session
- `git reset --hard` against a non-HEAD ref — discards another session's commits

**Required for branch work:** spawn a worktree.

```bash
BASE=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo main)
git worktree add -b <task-branch> ../<repo>-<task> "$BASE"
cd ../<repo>-<task>
# edit / commit / push from here; primary checkout is untouched
git worktree remove ../<repo>-<task>
```

The `BASE` lookup resolves the remote's default branch — usually `main`, but legacy repos still use `master`. Never hard-code one; use `git symbolic-ref refs/remotes/origin/HEAD` (or fall back to `main` if the remote isn't set). See [Default branch fallback](#default-branch-fallback) below.

**Required for staging:** surgical `git add <specific-file>`. Never `-A` / `.`.

**Never revert files you didn't touch.** If `git status` shows unfamiliar changes, leave them — they belong to another session, an upstream pull, or a hook side-effect.

The umbrella rule: never run a git command that mutates state belonging to a path other than the file you just edited.

### Default branch fallback

Always **favor `main` and fall back to `master`** when scripting git operations that target the default branch. Never hard-code either name — fleet repos are mostly on `main`, but a few legacy / vendored repos still use `master`, and a script that hard-codes `main` silently no-ops on those.

The canonical lookup, in order of preference:

```bash
# Best: ask the remote what its HEAD points to
BASE=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')

# Fallback 1: prefer main if it exists
if [ -z "$BASE" ] && git show-ref --verify --quiet refs/remotes/origin/main; then
  BASE=main
fi

# Fallback 2: fall back to master if main doesn't exist
if [ -z "$BASE" ] && git show-ref --verify --quiet refs/remotes/origin/master; then
  BASE=master
fi

# Last resort: assume main and let the next git command fail loudly
BASE="${BASE:-main}"
```

Apply this in: worktree creation, base-ref resolution for `git diff` / `git rev-list`, PR base detection in scripts, default-branch comparisons in skills, hook scripts that walk history. Documentation and CLAUDE.md examples can write `main` for clarity, but the underlying scripts must do the lookup.

The order **main → master** matches fleet reality (overwhelming majority on `main`); reversing it would silently pick the wrong branch in repos that have both (e.g., during a rename migration).

### Public-surface hygiene

🚨 The four rules below have hooks that re-print the rule on every public-surface `git` / `gh` command. The rules apply even when the hooks are not installed.

- **Real customer / company names** — never write one into a commit, PR, issue, comment, or release note. Replace with `Acme Inc` or rewrite the sentence to not need the reference. (No enumerated denylist exists — a denylist is itself a leak.)
- **Private repos / internal project names** — never mention. Omit the reference entirely; don't substitute "an internal tool" — the placeholder is a tell.
- **Linear refs** — never put `SOC-123`/`ENG-456`/Linear URLs in code, comments, or PR text. Linear lives in Linear.
- **Publish / release / build-release workflows** — never `gh workflow run|dispatch` or `gh api …/dispatches`. Dispatches are irrevocable. The user runs them manually. Bypass: a `gh workflow run` with `-f dry-run=true` is allowed when the target workflow declares a `dry-run:` input under `workflow_dispatch.inputs` and no force-prod override (`-f release=true` / `-f publish=true` / `-f prod=true`) is set.
- **Workflow input naming** — `workflow_dispatch.inputs` keys are kebab-case (`dry-run`, `build-mode`), not snake_case. The release-workflow-guard hook only recognizes kebab; a `dry_run` input silently fails the dry-run bypass.

### Commits & PRs

- Conventional Commits `<type>(<scope>): <description>` — NO AI attribution.
- **When adding commits to an OPEN PR**, update the PR title and description to match the new scope. Use `gh pr edit <num> --title … --body …`. The reviewer should know what's in the PR without scrolling commits.
- **Replying to Cursor Bugbot** — reply on the inline review-comment thread, not as a detached PR comment: `gh api repos/{owner}/{repo}/pulls/{pr}/comments/{comment_id}/replies -X POST -f body=…`.

### Programmatic Claude calls

🚨 Workflows / skills / scripts that invoke `claude` CLI or `@anthropic-ai/claude-agent-sdk` MUST set all four lockdown flags: `tools`, `allowedTools`, `disallowedTools`, `permissionMode: 'dontAsk'`. Never `default` mode in headless contexts. Never `bypassPermissions`. See `.claude/skills/locking-down-programmatic-claude/SKILL.md`.

### Tooling

- **Package manager**: `pnpm`. Run scripts via `pnpm run foo --flag`, never `foo:bar`. After `package.json` edits, `pnpm install`.
- 🚨 NEVER use `npx`, `pnpm dlx`, or `yarn dlx` — use `pnpm exec <package>` or `pnpm run <script>` # socket-hook: allow npx
- **Backward compatibility** — FORBIDDEN to maintain. Actively remove when encountered.
- Full ruleset (packageManager field, `.config/` placement, `.mts` runners, soak window, shallow submodules, monorepo `engines.node`) in [`docs/claude.md/tooling.md`](docs/claude.md/tooling.md).

### No "pre-existing" excuse

🚨 If you see a lint error, type error, test failure, broken comment, or stale comment **anywhere in your reading window** — fix it. Don't label it "pre-existing" and skip past. The label is a tell that you're rationalizing avoiding work; the user reads "pre-existing" the same as "I noticed but chose not to."

The only exceptions:

- The fix is genuinely out of scope (a 2000-line refactor would derail a one-line bug fix). State the trade-off explicitly and ask before deferring.
- You don't have permission (the file belongs to another session per the parallel-Claude rule).

In all other cases: fix it in the same commit, or in a sibling commit on the same branch. Never assume someone else will get to it.

### Unrelated issues are critical

🚨 An issue being **unrelated to the task** is not a reason to defer it — it's a reason to treat it as **critical and fix it immediately**. Unrelated bugs are exactly the bugs nobody is currently looking for; if you walk past one, no one else will catch it either. The instinct to "stay focused on the task" is how regressions accumulate.

When you spot an unrelated bug, broken comment, dead branch, type error, failing test, or stale config:

1. Stop the current task.
2. Fix the unrelated issue first, in its own commit on the same branch (or a sibling commit if scope demands it).
3. Resume the original task.

If the fix is genuinely too large to bundle (a 2000-line refactor on a one-line bug), state the trade-off explicitly and ask before deferring — same exception as the "no pre-existing excuse" rule. Otherwise: unrelated = critical = fix now.

### Don't leave the worktree dirty

🚨 When you finish a code change, **commit it**. Don't end a turn with uncommitted edits, untracked new files, or staged-but-uncommitted hunks lingering in the working tree. A dirty worktree is a half-finished job: another session, another agent, or a future `git checkout` will trip over it, and the user has to clean up after you.

Rules:

- **After finishing a logical unit of work, commit it.** Use a Conventional Commits message per the _Commits & PRs_ rule. Never leave the working tree dirty between turns.
- **Surgical staging only** — `git add <specific-file>`, never `-A` / `.` (per the _Parallel Claude sessions_ rule). The dirty-worktree rule is no excuse to sweep in files you didn't touch.
- **If you genuinely can't commit yet** (the change is mid-refactor, tests are failing, you're waiting on user input), say so explicitly in the turn summary so the user knows the dirty state is intentional. Silent dirty worktrees are the failure mode.
- **Worktrees from `git worktree add`** — same rule, sharper: a transient task-worktree must be left clean (committed + pushed) before `git worktree remove`, or the removal refuses and you've stranded the work.

The principle: the working tree at end-of-turn should match the user's mental model of where the work is. "Done" means committed; anything else is paused, and pause states need to be announced.

### Hook bypasses require the canonical phrase

🚨 Reverting tracked changes or bypassing a hook (--no-verify, DISABLE*PRECOMMIT*\*, --no-gpg-sign, force-push) requires the user to type **`Allow <X> bypass`** verbatim in a recent user turn (e.g. `Allow revert bypass`, `Allow no-verify bypass`). Paraphrases don't count. Enforced by `.claude/hooks/no-revert-guard/`. Full phrase table: [`docs/claude.md/bypass-phrases.md`](docs/claude.md/bypass-phrases.md).

### Variant analysis on every High/Critical finding

🚨 When a finding lands at severity High or Critical, **search the rest of the repo for the same shape** before closing it. Bugs cluster — same mental model, same antipattern. Three searches: same file (read the whole thing, not just the hunk), sibling files (`rg` the shape, not the names), cross-package (parallel implementations love to drift).

Skip for style nits. Full taxonomy in [`.claude/skills/_shared/variant-analysis.md`](.claude/skills/_shared/variant-analysis.md). Cross-fleet variants become a _Drift watch_ task — open `chore(sync): cascade <fix>`.

### Compound lessons into rules

When the same kind of finding fires twice — across two runs, two PRs, or two fleet repos — **promote it to a rule** instead of fixing it again. Land it in CLAUDE.md, a `.claude/hooks/*` block, or a skill prompt — pick the lowest-friction surface. Always cite the original incident in a `**Why:**` line. Skip the retrospective doc; the rule is the artifact. Discipline: [`.claude/skills/_shared/compound-lessons.md`](.claude/skills/_shared/compound-lessons.md).

### Plan review before approval

For non-trivial work (multi-file refactor, new feature, migration), the plan itself is a deliverable. List steps numerically, name files you'll touch, name rules you'll honor — don't bury the plan in prose. If the plan touches fleet-shared resources (this CLAUDE.md fleet block, hooks, `_shared/`), invite a second-opinion pass before writing code. If the plan adds a fleet rule, name the original incident (per _Compound lessons_).

### Drift watch

🚨 **Drift across fleet repos is a defect, not a feature.** When you see two socket-\* repos pinning different versions of the same shared resource — a tool in `external-tools.json`, a workflow SHA, a CLAUDE.md fleet block, an action in `.github/actions/`, an upstream submodule SHA, a hook in `.claude/hooks/` — **opt for the latest**. The repo with the newer version is the source of truth; older repos catch up.

Where drift commonly hides:

- `external-tools.json` — pnpm/zizmor/sfw versions + per-platform sha256s
- `socket-registry/.github/actions/*` — composite-action SHAs pinned in consumer workflows
- `template/CLAUDE.md` `<!-- BEGIN FLEET-CANONICAL -->` block — must be byte-identical across the fleet
- `template/.claude/hooks/*` — same hook, same code
- lockstep.json `pinned_sha` rows — upstream submodules tracked by socket-btm
- `.gitmodules` `# name-version` annotations
- pnpm/Node `packageManager`/`engines` fields

How to check:

1. If you're editing one of these in repo A, grep the same thing in repos B/C/D. If A is older, bump A first; if A is newer, plan a sync to B/C/D.
2. `socket-registry`'s `setup-and-install` action is the canonical source for tool SHAs. Diverging from it is drift.
3. `socket-wheelhouse`'s `template/` tree is the canonical source for `.claude/`, CLAUDE.md fleet block, and hook code. Diverging is drift.
4. Run `pnpm run sync-scaffolding` (in repos that have it) to surface drift programmatically.

Never silently let drift sit. Either reconcile in the same PR or open a follow-up PR titled `chore(sync): cascade <thing> from <newer-repo>` and link it.

### Never fork fleet-canonical files locally

🚨 Edit fleet-canonical files (anything in the sync manifest) ONLY in `socket-wheelhouse/template/...` — never in a downstream repo. Spot a missing helper in a downstream copy? Lift it upstream and re-cascade. Enforced by `.claude/hooks/no-fleet-fork-guard/`; bypass: `Allow fleet-fork bypass`. Full canonical-surface list + lifting workflow: [`docs/claude.md/no-local-fork-canonical.md`](docs/claude.md/no-local-fork-canonical.md).

### Code style

- **Comments** — default to none. When you do write one, audience is a junior dev: explain the constraint, the hidden invariant, the "why this and not the obvious thing." No teacher-tone.
- **Completion** — never leave `TODO` / `FIXME` / `XXX` / shims / stubs / placeholders. Finish 100%.
- **`null` vs `undefined`** — use `undefined`. `null` only for `__proto__: null` or external APIs.
- **HTTP** — never `fetch()`. Use `httpJson` / `httpText` / `httpRequest` from `@socketsecurity/lib/http-request`.
- **File deletion** — `safeDelete()` / `safeDeleteSync()` from `@socketsecurity/lib/fs`. Never `fs.rm` / `fs.unlink` / `rm -rf` directly.
- **Edits** — Edit tool, never `sed` / `awk`.
- Full ruleset (object literals, imports, subprocesses, file existence, generated reports, sorting, Promise.race, Safe suffix, `node:smol-*` modules, inclusive language) in [`docs/claude.md/code-style.md`](docs/claude.md/code-style.md). See also [`docs/claude.md/sorting.md`](docs/claude.md/sorting.md) and [`docs/claude.md/inclusive-language.md`](docs/claude.md/inclusive-language.md).

### File size

Soft cap **500 lines**, hard cap **1000 lines** per source file. Past those, split along natural seams — group by domain, not line count; name files for what's in them; co-locate helpers with consumers. Exceptions: a single function that legitimately needs the space (note it inline), or a generated artifact. Full playbook in [`docs/claude.md/file-size.md`](docs/claude.md/file-size.md).

### Lint rules: errors over warnings, fixable over reporting

- **Errors, not warnings.** Default `"error"` for new rules.
- **Fixable when possible.** Ship an autofix (`fixable: 'code'` + `fix(fixer) => ...`) whenever the rewrite is deterministic.
- **Skill or hook ≠ no rule.** Defense in depth — skill is docs, hook is edit-time, lint is commit-time.
- **Tooling: oxlint + oxfmt only.** No ESLint, no Prettier. Fleet socket-\* oxlint plugin lives in `template/.config/oxlint-plugin/`.
- **Invoke oxfmt / oxlint with `-c .config/...rc.json` explicitly.** Both tools accept a `-c PATH` (oxfmt) / `--config PATH` (oxlint). The fleet keeps both configs under `.config/`, not at repo root. Without the flag, the tools fall through to their built-in defaults — oxfmt's default is double-quotes + semis, the opposite of the fleet style, and would silently rewrite ~200 files on `pnpm run format`. Canonical script bodies in `manifest.mts` already encode the flag; the sync-scaffolding gate rewrites drifted scripts back to the canonical form.

Full rationale + cascade behavior in [`docs/claude.md/lint-rules.md`](docs/claude.md/lint-rules.md).

### 1 path, 1 reference

A path is constructed exactly once. Everywhere else references the constructed value.

- **Within a package**: every script imports its own `scripts/paths.mts`. No `path.join('build', mode, …)` outside that module.
- **Across packages**: package B imports package A's `paths.mts` via the workspace `exports` field. Never `path.join(PKG, '..', '<sibling>', 'build', …)`.
- **Workflows / Dockerfiles / shell** can't `import` TS — construct once, reference by output / `ENV` / variable.
- **Canonical layout**: build outputs live at `<package-root>/build/<mode>/<platform-arch>/out/Final/<artifact>`, where `mode ∈ {dev, prod}` and `platform-arch` is the Node-style `<process.platform>-<process.arch>` (e.g. `darwin-arm64`, `linux-x64`). socket-btm is the worked example; ultrathink follows it; smaller TS-only repos that don't fork by platform may use `'any'` as the platform-arch sentinel but keep the same nesting. Each package's `scripts/paths.mts` exports `PACKAGE_ROOT`, `BUILD_ROOT`, and `getBuildPaths(mode, platformArch)` returning at minimum `outputFinalDir` + `outputFinalFile`/`outputFinalBinary`.

Three-level enforcement: `.claude/hooks/path-guard/` blocks at edit time; `scripts/check-paths.mts` is the whole-repo gate run by `pnpm check`; `/guarding-paths` is the audit-and-fix skill. Find the canonical owner and import from it.

### Background Bash

Never use `Bash(run_in_background: true)` for test / build commands (`vitest`, `pnpm test`, `pnpm build`, `tsgo`). Backgrounded runs you don't poll get abandoned and leak Node workers. Background mode is for dev servers and long migrations whose results you'll consume. If a run hangs, kill it: `pkill -f "vitest/dist/workers"`. The `.claude/hooks/stale-process-sweeper/` `Stop` hook reaps true orphans as a safety net.

When writing or extending a Bash-allowlist hook, prefer **AST-based parsing** over regex matchers when the rule needs to reason about command structure (chains, subshells, redirects, command substitution). Regex matchers approve `git $(echo rm) foo.txt` because the surface looks like `git`; an AST parser sees the substitution and blocks. Pure-syntactic rules (binary name only) can stay regex; structure-sensitive rules (no writes to `.env*`, no destructive chains, no `$(…)` containing destructive verbs) need a parser. Pattern reference: https://github.com/ldayton/Dippy.

### Judgment & self-evaluation

- If the request is based on a misconception, say so before executing.
- If you spot an adjacent bug, flag it: "I also noticed X — want me to fix it?"
- Fix warnings (lint / type / build / runtime) when you see them — don't leave them for later.
- **Default to perfectionist** when you have latitude. "Works now" ≠ "right."
- Before calling done: perfectionist vs. pragmatist views. Default perfectionist absent a signal.
- If a fix fails twice: stop, re-read top-down, state where the mental model was wrong, try something fundamentally different.

### Error messages

An error message is UI. The reader should fix the problem from the message alone. Four ingredients in order:

1. **What** — the rule, not the fallout (`must be lowercase`, not `invalid`).
2. **Where** — exact file / line / key / field / flag.
3. **Saw vs. wanted** — the bad value and the allowed shape or set.
4. **Fix** — one imperative action (`rename the key to …`).

Use `isError` / `isErrnoException` / `errorMessage` / `errorStack` from `@socketsecurity/lib/errors` over hand-rolled checks. Use `joinAnd` / `joinOr` from `@socketsecurity/lib/arrays` for allowed-set lists. Full guidance in [`docs/claude.md/error-messages.md`](docs/claude.md/error-messages.md).

### Token hygiene

🚨 Never emit the raw value of any secret to tool output, commits, comments, or replies. The `.claude/hooks/token-guard/` `PreToolUse` hook blocks the deterministic patterns; when it blocks, rewrite — don't bypass. Redact `token` / `jwt` / `api_key` / `secret` / `password` / `authorization` fields when citing API responses.

**Socket API token env var** — canonical fleet name is `SOCKET_API_TOKEN` (legacy `SOCKET_API_KEY` / `SOCKET_SECURITY_API_TOKEN` / `SOCKET_SECURITY_API_KEY` accepted as aliases for one cycle). Don't confuse with `SOCKET_CLI_API_TOKEN` (socket-cli's separate setting).

Full spec (hook details, personal-path placeholders, cross-repo path references) in [`docs/claude.md/token-hygiene.md`](docs/claude.md/token-hygiene.md).

### Agents & skills

- `/scanning-security` — AgentShield + zizmor audit
- `/scanning-quality` — quality analysis
- Shared subskills in `.claude/skills/_shared/`
- **Handing off to another agent** — see [`docs/claude.md/agent-delegation.md`](docs/claude.md/agent-delegation.md).
- **Skill scope tiers** (fleet / partial / unique), the `updating` umbrella + `updating-*` siblings convention, and the `scripts/run-skill-fleet.mts` cross-fleet runner in [`docs/claude.md/agents-and-skills.md`](docs/claude.md/agents-and-skills.md).

<!-- END FLEET-CANONICAL -->

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
- **NEVER revert files you didn't touch.** If `git status` shows files you didn't modify, those belong to another session, an upstream pull, or a hook side-effect — leave them alone. Specifically: do not run `git checkout -- <unrelated-path>` to "clean up" the diff before committing, and do not include unrelated paths in `git add`. Stage only the explicit files you edited.

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

## ERROR MESSAGES

An error message is UI. The reader should be able to fix the problem from the message alone, without opening your source.

Every message needs four ingredients, in order:

1. **What** — the rule that was broken (e.g. "must be lowercase"), not the fallout ("invalid").
2. **Where** — the exact file, line, key, field, or CLI flag. Not "somewhere in config".
3. **Saw vs. wanted** — the bad value and the allowed shape or set.
4. **Fix** — one concrete action, in imperative voice (`rename the key to …`, not `the key was not renamed`).

Length depends on the audience:

- **Library API errors** (thrown from a published package): terse. Callers may match on the message text, so every word counts. All four ingredients often fit in one sentence — e.g. `name "__proto__" cannot start with an underscore` covers rule, where (`name`), saw (`__proto__`), and implies the fix.
- **Validator / config / build-tool errors** (developer reading a terminal): verbose. Give each ingredient its own words so the reader can find the bad record without re-running the tool.
- **Programmatic errors** (internal assertions, invariant checks): terse, rule only. No end user will see it; short keeps the check readable.

Rules for every message:

- Imperative voice for the fix — `add "filename" to part 3`, not `"filename" was missing`.
- Never "invalid" on its own. `invalid filename 'My Part'` is fallout; `filename 'My Part' must be [a-z]+ (lowercase, no spaces)` is a rule.
- On a collision, name **both** sides, not just the second one found.
- Suggest, don't auto-correct. Silently fixing state hides the bug next time.
- Bloat check: if removing a word keeps the information, drop it.
- For allowed-set / conflict lists, use `joinAnd` / `joinOr` from `@socketsecurity/lib/arrays` — `must be one of: ${joinOr(allowed)}` reads better than a hand-formatted list.

Caught-value helpers from `@socketsecurity/lib/errors` (prefer these in **scripts** over hand-rolled checks; `src/` uses primordial-guarded helpers from `src/error.ts` instead):

- `isError(e)` — replaces `e instanceof Error`. Cross-realm-safe.
- `isErrnoException(e)` — replaces `'code' in err` guards. Narrows to `NodeJS.ErrnoException`.
- `errorMessage(e)` — replaces `e instanceof Error ? e.message : String(e)` and any `'Unknown error'` fallback. Walks the `cause` chain.
- `errorStack(e)` — cause-aware stack or `undefined`.

Examples:

- ✗ `Error: invalid config` → ✓ `config.json: part 3 is missing "filename". Add a lowercase filename (e.g. "parsing").`
- ✗ `Error: invalid component` → ✓ `npm "name" component is required`

See `docs/references/error-messages.md` for worked examples and anti-patterns.

## ABSOLUTE RULES

- Never create files unless necessary; always prefer editing existing files
- Forbidden to create docs unless requested
- 🚨 **NEVER leave `TODO`, `FIXME`, `XXX`, shims, stubs, or placeholder code** — finish 100%. If the task is too large for a single pass, **inform the user and ask** before cutting scope; don't silently reduce scope, and don't land half-work with a promise to fix it later.
- 🚨 **NEVER use `npx`, `pnpm dlx`, or `yarn dlx`** — use `pnpm exec` or `pnpm run` <!-- # zizmor: docs mention forbidden tools intentionally -->

- **minimumReleaseAge**: NEVER add packages to `minimumReleaseAgeExclude` in CI. Locally, ASK before adding — the age threshold is a security control.

- 🚨 **NEVER mention private repos or internal project names** in commits, PR titles/descriptions/comments, issues, release notes, or any public-surface text. Internal codenames, unreleased product names, internal tooling repo names not on the public org page, customer names, partner names — none belong in public surfaces. **Omit the reference entirely.** Don't substitute a placeholder ("an internal tool", "a downstream consumer", etc.) — the placeholder itself is a tell that something is being elided. Rewrite the sentence to not need the reference at all.
- 🚨 **NEVER trigger Publish / Release / Provenance / Build-Release workflows** — no `gh workflow run`, `gh workflow dispatch`, or `gh api .../dispatches`. Workflow dispatches are irrevocable: Publish workflows push npm versions (unpublishable after 24h), Build/Release workflows pin GitHub releases by SHA, container workflows push immutable tags. Even build workflows with a `dry_run` input still treat the dispatch itself as the prod trigger. The user runs workflow_dispatch jobs manually after CI passes on the release commit + tag — Claude **never** dispatches them. If the user asks for a publish, tell them to run the command in their own terminal (or the GitHub Actions UI).
- 🚨 **Programmatic Claude calls** (workflows, skills, scripts that invoke `claude` CLI or `@anthropic-ai/claude-agent-sdk`) MUST set all four lockdown flags: `--tools`/`tools`, `--allowedTools`/`allowedTools`, `--disallowedTools`/`disallowedTools`, and `--permission-mode dontAsk`/`permissionMode: 'dontAsk'`. NEVER `default` mode in headless contexts (falls through to a missing `canUseTool` → undefined behavior). NEVER `bypassPermissions`. See `.claude/skills/programmatic-claude-lockdown/SKILL.md` for the recipe + reference impl (`socket-lib/tools/prim/src/disambiguate.mts`).

## 📚 SHARED STANDARDS

- Commits: [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) `<type>(<scope>): <description>` — NO AI attribution
- **Open PRs:** when adding commits to an OPEN PR, ALWAYS update the PR title and description to match the new scope. A title like `chore: foo` after you've added security-fix and docs commits to it is now a lie. Use `gh pr edit <num> --title "..." --body "..."` (or `--body-file`) and rewrite the body so it reflects every commit on the branch, grouped by theme. The reviewer should be able to read the PR description and know what's in it without scrolling commits.
- Scripts: Prefer `pnpm run foo --flag` over `foo:bar` variants
- Dependencies: After `package.json` edits, run `pnpm install`
- Backward Compatibility: 🚨 FORBIDDEN to maintain — actively remove when encountered
- Work Safeguards: MANDATORY commit + backup branch before bulk changes
- Safe Deletion: Route **every** filesystem delete through `safeDelete()` (async) or `safeDeleteSync()` (sync) from `@socketsecurity/lib/fs`. NEVER reach for `fs.rm` / `fs.rmSync` / `fs.unlink` / `fs.unlinkSync` / `fs.rmdir` / `fs.rmdirSync` / `rm -rf` — even for a single known file. The rule is "all deletes go through the safe helpers," not "except when the blast radius is small"; uniform routing is what keeps audit + retry + signal-abort behavior consistent.
- HTTP Requests: NEVER use `fetch()` — use `httpJson`/`httpText`/`httpRequest` from `@socketsecurity/lib/http-request`
- File existence: ALWAYS `existsSync` from `node:fs`. NEVER `fs.access`, `fs.stat`-for-existence, or an async `fileExists` wrapper. Import form: `import { existsSync, promises as fs } from 'node:fs'`.

### 1 path, 1 reference

**A path is _constructed_ exactly once. Everywhere else _references_ the constructed value.**

Referencing a single computed path many times is fine — that's the whole point of computing it once. What's banned is _re-constructing_ the same path in multiple places, because that's where drift is born.

- **Within a package**: every script imports its own `scripts/paths.mts` (or `lib/paths.mts`). No `path.join('build', mode, ...)` outside that module.
- **Across packages**: when package B consumes package A's output, B imports A's `paths.mts` via the workspace `exports` field. Never `path.join(PKG, '..', '<sibling>', 'build', ...)`.
- **Workflows, Dockerfiles, shell scripts**: they can't `import` TS, so they construct the string once and reference it everywhere downstream. Workflows: a "Compute paths" step exposes `steps.paths.outputs.final_dir`; later steps read `${{ steps.paths.outputs.final_dir }}`. Dockerfiles/shell: assign once to a variable / `ENV`, reference by name thereafter. Each canonical construction carries a comment naming the source-of-truth `paths.mts`. **Re-building** the same path in a second step is the violation, not referring to the constructed value many times.
- **Comments**: may describe path _structure_ with placeholders ("`<mode>/<arch>`") but should not encode a complete literal path string. The import statement IS the comment.

Code execution takes priority over docs: violations in `.mts`/`.cts`, Makefiles, Dockerfiles, workflow YAML, and shell scripts are blocking. README and doc-comment violations are advisory unless they contain a fully-qualified path with no parametric placeholders.

**Three-level enforcement:**

- **Hook** — `.claude/hooks/path-guard/` blocks `Edit`/`Write` calls that would introduce a violation in a `.mts`/`.cts` file at edit time.
- **Gate** — `scripts/check-paths.mts` runs in `pnpm check`. Fails the build on any violation that isn't allowlisted in `.github/paths-allowlist.yml`.
- **Skill** — `/path-guard` audits the repo and fixes findings; `/path-guard check` reports only; `/path-guard install` drops the gate + hook + rule into a fresh repo.

The mantra is intentionally short so it sticks: **1 path, 1 reference**. When in doubt, find the canonical owner and import from it.

### Inclusive Language

Use precise, neutral terms over historical metaphors that imply hierarchy or exclusion. The substitutes are not euphemisms — they're more _accurate_ (a list of allowed values genuinely is an "allowlist"; "whitelist" is a metaphor that hides what the list does).

| Replace                          | With                                                |
| -------------------------------- | --------------------------------------------------- |
| `whitelist` / `whitelisted`      | `allowlist` / `allowed` / `allowlisted`             |
| `blacklist` / `blacklisted`      | `denylist` / `denied` / `blocklisted` / `blocked`   |
| `master` (branch, process, copy) | `main` (branch); `primary` / `controller` (process) |
| `slave`                          | `replica`, `worker`, `secondary`, `follower`        |
| `grandfathered`                  | `legacy`, `pre-existing`, `exempted`                |
| `sanity check`                   | `quick check`, `confidence check`, `smoke test`     |
| `dummy` (placeholder)            | `placeholder`, `stub`                               |

Apply across **code** (identifiers, comments, string literals), **docs** (READMEs, CLAUDE.md, markdown), **config files** (YAML, JSON), **commit messages**, **PR titles/descriptions**, and **CI logs** you control.

Two exceptions where the legacy term must remain (because changing it breaks something external):

- **Third-party APIs / upstream code**: when interfacing with an external API field literally named `whitelist`, keep the field name; rename your local variable. E.g. `const allowedDomains = response.whitelist`.
- **Vendored upstream sources**: don't rewrite vendored code (`vendor/**`, `upstream/**`, `**/fixtures/**`). Patch around it if needed.

When you encounter a legacy term during unrelated work, fix it inline — don't defer.

### Sorting

Sort lists alphanumerically (literal byte order, ASCII before letters). Apply this to:

- **Config lists** — `permissions.allow` / `permissions.deny` in `.claude/settings.json`, `external-tools.json` checksum keys, allowlists in workflow YAML.
- **Object key entries** — sort keys in plain JSON config + return-shape literals + internal-state objects. (Exception: `__proto__: null` always comes first, ahead of any data keys.)
- **Import specifiers** — sort named imports inside a single statement: `import { encrypt, randomDataKey, wrapKey } from './crypto.mts'`. Imports that say `import type` follow the same rule. Statement _order_ is the project's existing convention (`node:` → external → local → types) — that's separate from specifier order _within_ a statement.
- **Method / function source placement** — within a module, sort top-level functions alphabetically. Convention: private functions (lowercase / un-exported) sort first, exported functions second. The first-line `export` keyword is the divider.
- **Array literals** — when the array is a config list, allowlist, or set-like collection. Position-bearing arrays (e.g. argv, anything where index matters semantically) keep their meaningful order.
- **`Set` constructor arguments** — `new Set([...])` and `new SafeSet([...])` literals. The runtime is order-insensitive, so source order is alphanumeric. Same rationale as Array literals: predictable diffs, no merge conflicts on insertions.

When in doubt, sort. The cost of a sorted list that didn't need to be is approximately zero; the cost of an unsorted list that did need to be is a merge conflict.

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
