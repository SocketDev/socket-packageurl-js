---
name: codifying-footguns
description: Turn a repeated mistake into an enforcement artifact: hook, lint rule, script, or doctrine line.
user-invocable: true
# Judgment: choosing the right enforcement artifact for a mistake is a design
# call, not a mechanical edit.
model: sonnet
allowed-tools: Read, Edit, Write, Glob, Grep, Bash(node scripts/fleet/*:*), Bash(pnpm run *:*), Bash(git:*), Bash(ls:*)
metadata:
  internal: true
---

# codifying-footguns

A footgun you only write down repeats. The rule is: **the same pass that hits it
produces the artifact that prevents it.** Not the next session, not a follow-up
line in a report.

This skill exists because "I hit X again" was said several times in one session
about mistakes that already had notes written about them. A note is not
enforcement.

The memory side of this is `docs/agents.md/fleet/memory-codification.md`: a
memory stating an enforceable rule carries an `enforcement:` line naming the
artifact. That page says a lesson needs an enforcer; this one is how to build
one.

## Measure before you write

The step people skip, and the one that decides whether the artifact is worth
having. Run the candidate pattern across the tree and read the hits.

```sh
grep -rEIho "<pattern>" --include='*.mts' . | wc -l
```

Then judge:

- **Mostly true positives** - write the rule, and fix every existing hit in the
  same pass. A rule that ships with a backlog teaches everyone its findings are
  normal.
- **Mostly legitimate use** - do NOT write it. Measured examples that were
  rejected for exactly this: bare `used to <verb>` is half passive-purpose
  (`Used to gate the bypass`), `in the past` is always a date comparison,
  `historically` reads as present-tense legacy state, and `spawnSync` without
  `stdioString` is 292 of 334 callsites.
- **Zero hits, high severity** - a prophylactic rule is fine, but say so. It
  carries no cleanup and proves nothing about the past.

Re-measure through the REAL entry point afterwards, not a reimplementation. An
audit script that loops per-item where the guard groups items over-reports; that
turned a real count of 5 into a chased 33.

## Pick the artifact

| The footgun is | Use | Because |
| --- | --- | --- |
| A command shape (bash, git, a CLI) | **hook**, PreToolUse | Only a hook sees a tool call before it runs |
| Something written into a file | **oxlint rule** | It is checkable from source, in CI, forever |
| Advice you handed the operator | **hook**, Stop/PostToolUse | Prose is not a tool call; the bash-side guard never sees it |
| A multi-step flow people re-derive | **script** (`.mts`) + a `package.json` entry | The script owns the argv nobody should retype |
| A judgement call with no single right answer | **skill** | A checklist beats a blocker when the answer is contextual |
| A fact about intent or preference | **doctrine line** in `CLAUDE.md`, or a memory | Nothing to detect, so nothing to enforce |

One artifact per pattern. Two patterns in one rule cannot be dropped
independently when one stops earning its keep.

## Checklist: a new hook

- [ ] Registry bullet in `docs/agents.md/fleet/hook-registry.md`, or inline in
      `CLAUDE.md`. `new-hook-claude-md-guard` BLOCKS the `Write` until this
      exists - policy with no entry is policy nobody can look up.
- [ ] `void runHook(hook, import.meta.url)`, with the `void`. `dispatch-scan`
      matches that literal text; without it the hook is dropped from the
      dispatch table and never runs. `socket/require-void-run-hook` catches it.
- [ ] `global: true` if the rule holds in ANY repo, then
      `pnpm run sync-global-hooks`. A global hook not named in
      `~/.claude/settings.json` never fires outside a fleet checkout.
- [ ] Tests import the CANONICAL `template/base/...` path, or the mirror is
      materialized first. Editing canonical while testing the mirror is a
      silent pass.
- [ ] `node scripts/repo/bootstrap/fleet.mjs --from-template` then
      `node scripts/fleet/gen/hook-dispatch.mts`. The generated count going up
      by one is the proof it registered.
- [ ] The block message names what and why in one line, plus one `Fix:` line.
- [ ] A bypass phrase, unless the rule must never be overridden.

## Checklist: a new oxlint rule

- [ ] `fleet/<name>/index.mts` and `fleet/<name>/package.json`.
- [ ] Registered in `.config/fleet/oxlint-plugin/index.mts`, both the import and
      the rules map, alphabetically.
- [ ] Enabled in `.config/fleet/oxlintrc.json`.
- [ ] `node scripts/fleet/build-oxlint-bundle.mts`. The bundle is generated and
      gitignored; without a rebuild oxlint reports
      `Rule '<name>' not found in plugin 'socket'`.
- [ ] `RuleTester` cases, with the VALID cases pinning the narrowness. The valid
      list is what stops the rule being disabled later.
- [ ] `pnpm run lint --all` clean, and the finding count stated in the commit.
- [ ] Autofix only when the rewrite carries no judgement.

## Checklist: a new script

- [ ] A `package.json` entry, so it is reachable as `pnpm run <name>` and a
      guard can redirect to it.
- [ ] A `--check` mode that reports and exits non-zero without writing, so the
      doctor and CI can consume it.
- [ ] `runMain` + `isMainModule`, bare, matching the other 449 callsites.
- [ ] Pure halves exported and unit-tested; the I/O half kept thin.
- [ ] Additive when it edits a file it does not own. Never prune what you do not
      recognize.
- [ ] If it replaces a raw command, add it to
      `_shared/script-redirects.mts` so both the bash-side and emission-side
      guards route to it.

## Checklist: doctrine only

- [ ] One line in `CLAUDE.md`, with the enforcing artifact in parentheses if one
      exists.
- [ ] A `docs/agents.md/fleet/*.md` page when it needs more than a line.
- [ ] Say plainly that it is unenforced. An unenforced rule is a preference, and
      calling it a law is how it gets ignored.

## Do not

- Do not report a footgun and move on. If it is worth naming, it is worth
  codifying, and naming-then-deferring is the failure this skill replaces.
- Do not write the artifact without measuring. A rule that cries wolf gets
  disabled, and then the real finding is invisible.
- Do not leave existing violations. Fix them in the same pass and re-measure to
  zero.
- Do not widen a measured-narrow pattern later without re-measuring. Record the
  rejected candidates and their numbers in the source so the next person does
  not re-add them.
