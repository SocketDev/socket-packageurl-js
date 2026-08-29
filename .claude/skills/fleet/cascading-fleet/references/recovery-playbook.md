## Recovery playbook - the judgment exceptions a plain run can't decide

The cascade script (`lib/cascade-template.mts`) is deterministic - it `--no-verify` commits + pushes per repo and always cleans up its worktree (verified: the success path, every early-exit, and the PR-fallback all run `worktree remove --force` + `branch -D`). What it CANNOT decide are these three situations. Each needs a human/agent call, not a script branch:

1. **Dirty downstream checkout** (`<repo>: working tree dirty — manual sync needed`). The script skips dirty checkouts so it never sweeps another agent's work. To unblock:
   - If the dirt is **mechanical sync/format drift** (oxlintrc array-collapse, jsdoc reflow, `.gitattributes`/CLAUDE.md fleet-block) - commit it as `chore(wheelhouse): cascade template@<sha>` (or `style:` for pure reflow). Safe; it IS cascade output.
   - If the dirt is **hand-authored feature work** in `src/` touched recently - leave it; that's a live session. Re-run the cascade after they land.
   - A `pnpm-lock.yaml` left dirty by a pre-commit `pnpm install` is regenerable: `git checkout -- pnpm-lock.yaml` before rebase/push.

2. **Stranded local commits** (local `main` diverged with un-pushed `chore(wheelhouse): cascade …` commits that origin already superseded). Confirm with `git branch -r --contains <sha>` (empty = local-only) and `git log --oneline HEAD..origin/main` (origin has newer cascades). If origin already has the work in canonical form, `git reset --hard origin/main` (needs `Allow reset bypass`) - nothing real is lost. Otherwise rebase the genuine local-unique commits on top.

3. <!-- oxlint-disable-next-line socket/no-cross-repo-path --> **Soak-bypassing a tool bump** (pnpm/zizmor/sfw newer than the 7-day `minimumReleaseAge`). The auto-updater (`scripts/repo/update-external-tools.mts`, dry-run by default; `--apply` flushes) skips fresh releases. To bump anyway: hand-pin `external-tools.json` (version + every platform asset + recomputed sha256 integrity from the upstream GitHub release; npm-tarball platforms use npm `dist.integrity`), needs `Allow soak-time bypass` (alias: `Allow minimumReleaseAge bypass`). Then run the wheelhouse tool-pin pipeline (`node scripts/repo/pipeline.mts`, from the wheelhouse) to bump, reconcile, and gate on CI-green, then commit the `external-tools.json` bump and cascade it fleet-wide with this skill. **Why:** a `packageManager` pin that drifts from the CI runner's pnpm red-lines fleet CI, and a pnpm bump can surface a previously-dormant `allowBuilds` placeholder that then trips `ERR_PNPM_IGNORED_BUILDS` - bump the tool and reconcile the build allowlist in the same wave.

## Worktree cleanup: the branch-cleanup bug

A subtle gotcha: the script's pre-clean step (`git branch -D <branch>`) MUST run from `${src}` (the source repo), not from `/tmp` or the worktree directory. If the loop crashes mid-iteration before `cd`-ing into the worktree, a stale `chore/wheelhouse-<sha>` branch can be left behind. The provided script handles this. If you write a one-off cascade, make sure your cleanup runs from the right cwd.

## Soak time before catalog cascades

If the wheelhouse template change includes a `@socketsecurity/lib` catalog bump in `pnpm-workspace.yaml`, wait at least 5 minutes after the npm publish completes before starting the cascade. The cascade's `pnpm install` step will 404 if the new version isn't yet visible on the npm CDN.
