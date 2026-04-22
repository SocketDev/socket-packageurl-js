# Contributing

What you need to know before opening a PR against
`@socketregistry/packageurl-js`. Dev setup, the test/coverage/lint
workflow, the parallel-session git rules, and the pre-PR checklist.

## Who this is for

First-time contributors and returning ones who want to refresh on
the commands and conventions. Reading order: **Setup → Making a
change → Running checks → Opening the PR**.

## Setup

Requirements:

| Tool | Version | Notes |
|---|---|---|
| Node.js | ≥ 22 | Built-in TypeScript stripping (`--experimental-strip-types` on 22, default on 23+). |
| pnpm | ≥ 11.0.0-rc.0 | Install via `corepack enable pnpm` or `npm install -g pnpm`. |
| git | ≥ 2.30 | Submodule support. |

Clone and install:

```bash
git clone https://github.com/SocketDev/socket-packageurl-js.git
cd socket-packageurl-js
pnpm install
```

`pnpm install` also:

- Sets up the `husky` pre-commit hooks.
- Initializes `upstream/meander` submodule lazily on first
  `pnpm tour:build`.

`pnpm tour doctor` reports which external tools the build may shell
out to are present vs missing on your machine. All listed tools are
optional; missing ones fall back to safe defaults.

## Repo layout

```
socket-packageurl-js/
├── src/                    ← library source (see docs/architecture.md)
├── test/                   ← functional tests (vitest)
├── scripts/                ← build/lint/test/release scripts
├── docs/                   ← these docs
├── val/                    ← Val Town comment backend (tour-specific)
├── upstream/meander/       ← submodule (tour generator)
├── .config/                ← tsconfig + vitest configs
├── .github/workflows/      ← CI (ci.yml, pages.yml, provenance.yml, ...)
├── .claude/                ← Claude Code config (agents, skills, hooks)
├── tour.json               ← tour manifest
└── walkthrough/            ← tour build output (gitignored)
```

You almost never edit `upstream/meander/` (that's the submodule
we pin) or `walkthrough/` (build output).

## Making a change

### 1. Branch, worktree, or sibling clone

This repo expects **multiple concurrent Claude Code sessions** may
be working on the same checkout. Plain `git checkout -b` inside the
main clone yanks the working tree out from under any other session.
Use one of:

- **Worktree** — `git worktree add -b my-task ../socket-packageurl-js-my-task main`
- **Sibling clone** — clone the repo elsewhere entirely
- **Same clone** — only if you are sure nobody else has a session
  going

See the `PARALLEL CLAUDE SESSIONS` section of `CLAUDE.md` for the
full doctrine.

### 2. Edit source

Per `CLAUDE.md`:

- TypeScript strict mode; type imports must be in separate
  `import type` lines.
- No `null` except `__proto__: null` or external-API requirement —
  use `undefined`.
- `{ __proto__: null, ...payload }` for config/return/internal
  objects.
- No dynamic imports (`await import(...)`).
- No `fetch()` — use `httpJson` / `httpText` / `httpRequest` from
  `@socketsecurity/lib/http-request`.
- For file existence: `existsSync` from `node:fs`. For deletion:
  `safeDelete` / `safeDeleteSync` from `@socketsecurity/lib/fs` —
  never reach directly for `fs.rm` / `fs.unlink` / `fs.rmdir`.
- Default to NO comments in code. Only where the WHY is
  non-obvious to a senior engineer.
- Use the `Edit` tool for text changes; never `sed` / `awk`.

### 3. Write tests

Two vitest configs:

| Config | When | File naming |
|---|---|---|
| `.config/vitest.config.mts` | Normal tests. Threads, shared memory. Fast. | `*.test.mts` |
| `.config/vitest.config.isolated.mts` | Tests that mock globals via `vi.doMock`, modify `process.env`, or `process.chdir`. Forks, full isolation. | `*.isolated.test.mts` |

**Test style in this repo:** functional. Tests assert behavior via
the public API — inputs → outputs. Tests never read source files
and assert on their contents.

Example:

```typescript
import { test, expect } from 'vitest'
import { PackageURL } from '../src/package-url.js'

test('parses npm scoped package', () => {
  const purl = new PackageURL('pkg:npm/@scope/pkg@1.0.0')
  expect(purl.namespace).toBe('@scope')
  expect(purl.name).toBe('pkg')
  expect(purl.version).toBe('1.0.0')
})
```

If you are adding a new ecosystem or URL parser, put tests under
`test/purl-types/<name>.test.mts` or
`test/url-converter/<name>.test.mts`.

## Running checks

The **canonical pre-PR check** is a single command:

```bash
pnpm check
```

It runs:

1. `pnpm type` — tsgo strict type-check.
2. `pnpm lint` — oxlint across the tree.
3. `pnpm test` — vitest (both configs).
4. Format verification.

Every step runs independently too:

| Command | What |
|---|---|
| `pnpm build` | Compile `src/` → `dist/` (esbuild). `pnpm build --watch` for dev. |
| `pnpm type` | Strict TypeScript check, no emit. |
| `pnpm lint` | oxlint. |
| `pnpm fix` | Auto-fix what's auto-fixable (formatter + lint autofixes). |
| `pnpm test` | Run vitest. `pnpm test:unit path/to/file.test.mts` for a single file. Never use `--` before test paths — runs ALL tests. |
| `pnpm testu` | Update vitest snapshots (review the diff before committing). |
| `pnpm cover` | Coverage. Must stay at 100%. |
| `pnpm format` | Run oxfmt across the tree (writes fixes). |
| `pnpm format --check` | Verify formatting without writing. |
| `pnpm security` | AgentShield + zizmor security scan. |

### Coverage — the 100% rule

`pnpm cover` must report 100% line/branch/function coverage.

If you add a code path, add a test that exercises it. If you
discover a corner case while reading, add a test for it even if the
coverage number already says 100% (percentages can miss edge
cases).

When coverage drops, the failure names the file and the missed
line/branch. Add a test or document an `/* c8 ignore next */` with
a justification comment.

### Snapshot tests

`pnpm testu` regenerates snapshots. Never run this unless the
snapshot drift is intentional — otherwise you are deleting future-
you's safety net. Review the snapshot diff before committing.

## The parallel-session git rules

Forbidden in the primary checkout (the one another session may be
editing):

- `git stash` / `git stash pop` — shared store; another session
  can pop yours.
- `git add -A` / `git add .` — sweeps files belonging to other
  sessions.
- `git checkout <branch>` / `git switch <branch>` — yanks the
  working tree.
- `git reset --hard` against a non-HEAD ref — discards another
  session's commits.

Required for branch work:

```bash
git worktree add -b <task-branch> ../<repo>-<task> main
cd ../<repo>-<task>
# edit, commit, push from here
cd -
git worktree remove ../<repo>-<task>
```

Required for staging:

```bash
git add <specific-file> [<file>…]
```

Never `-A` / `.`.

For a quick WIP save: commit on a new branch from inside a
worktree, not a stash.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/):

```
<type>(<scope>): <description>

<optional body>

<optional footer>
```

Types used in this repo:

- `feat` — new feature
- `fix` — bug fix
- `refactor` — restructure without behavior change
- `docs` — documentation only
- `test` — tests only
- `chore` — tooling, deps, repo config
- `style` — formatting / whitespace

Scopes are free-form but stable: `purl-types/npm`, `url-converter`,
`tour`, `hardening`. One commit = one concern. If the body
explains both a refactor and a fix, they should probably be two
commits.

**Never add AI attribution** ("Co-authored-by: Claude", etc.) to
commit messages. Humans commit; tools assist.

## Opening a PR

After `pnpm check` passes and all commits are conventional:

```bash
gh pr create --title "<conventional title>" --body "…"
```

The PR body should:

- Summarize the change (1–3 bullets).
- Include a test plan as a markdown checklist.
- Link any related issue (`Fixes #123` if applicable).

CI will run:

- `.github/workflows/ci.yml` — full `pnpm check` in a clean env.
- `.github/workflows/pages.yml` — if you touched tour sources,
  rebuilds the tour and deploys to GH Pages on merge to main.
- `.github/workflows/valtown.yml` — if you touched `val/`,
  deploys the comment backend after merge.
- `.github/workflows/provenance.yml` — on tag, signs + publishes
  to npm with attestations.

## Pre-PR checklist

Copy into your PR description and tick off:

- [ ] `pnpm check` passes locally.
- [ ] `pnpm cover` still at 100%.
- [ ] New tests for new behavior (functional style, public API).
- [ ] No `null`, no `fetch()`, no `fs.rm`/`unlink`/`rmdir` direct
      calls.
- [ ] Commit messages are Conventional, no AI attribution.
- [ ] Documentation touched if user-facing behavior or API changed.
- [ ] For new ecosystem handlers: entry in `src/purl-types/`,
      registered in `src/purl-type.ts`, builder factory in
      `src/package-url-builder.ts`, tests.
- [ ] `CLAUDE.md` + `docs/*` updated if conventions shifted.

## Hazards

Things that have caught contributors before:

- **Forgetting to bump `upstream/meander`** when the pin is stale.
  `pnpm tour:build --refresh` will re-clone and rebuild.
- **Running `pnpm testu` by accident** — if you only wanted to
  run tests, use `pnpm test`. `testu` updates snapshots.
- **Editing `dist/` directly** — it's a build artifact. Changes
  here are lost on next build. Edit `src/` and rebuild.
- **`pnpm install` side-effects** — the install step runs `husky`
  to set up git hooks. A bare `npm install` in this repo will skip
  that and PRs will push with unformatted files. Use pnpm.
- **`.env.local` accidentally committed** — it's gitignored; don't
  `git add -A`.
- **`minimumReleaseAge` exclusions** — NEVER add packages to
  `minimumReleaseAgeExclude` in CI. Locally, ask before adding.
  The age threshold is a security control.

## Further reading

- [`CLAUDE.md`](../CLAUDE.md) — project-wide conventions, error
  message doctrine, safe-deletion rule, parallel-sessions rules.
- [`docs/architecture.md`](./architecture.md) — how `src/` fits
  together.
- [`docs/tour.md`](./tour.md) — the build pipeline that ships
  these docs as HTML.
- [`docs/release.md`](./release.md) — what happens when we tag.
- [`package.json`](../package.json) — every script spelled out.
