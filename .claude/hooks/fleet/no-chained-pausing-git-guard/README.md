# no-chained-pausing-git-guard

**Type:** PreToolUse hook (GUARD - blocks).

## What it does

Blocks one Bash call that chains a PAUSING git operation (rebase,
merge, cherry-pick, am, revert, stash pop/apply) ahead of another git
MUTATION in the same command line.

Why this exists: a pausing op does not finish when it hits a conflict
- it stops mid-flight, leaves HEAD detached, and prints the
resolution instructions. Chained, two things then go wrong at once:
with `;` the next command runs anyway, and with `| tail`/`| grep` the
instructions are swallowed, so the failure is invisible. A real
incident: `git rebase origin/main 2>&1 | tail -1; git push --no-verify
origin HEAD:main` - the rebase stopped on a conflict, its output was
eaten by the pipe, and the push ran against a DETACHED HEAD, where it
reported "Everything up-to-date" while six commits sat unpushed. A
silent no-op that reads like success is the worst possible outcome for
a state-changing command.

The rule is not "never chain git". Chaining read-only git (status,
log, diff, rev-parse) is how you keep a turn cheap, and even
`git commit && git push` is fine: commit either succeeds or fails
cleanly, and `&&` respects that. Only the ops that can PAUSE are the
hazard, because their failure mode is a half-finished repository
rather than a nonzero exit.

DENIES (pausing op + a later git mutation, any separator):
- git rebase … ; git push …
- git rebase … && git push …
- git merge … && git commit …
- git cherry-pick … ; git reset …

ALLOWS:
- git rebase … alone (run it, read it, then act)
- git rebase … && git status / git log  (reads after)
- git commit … && git push …            (neither op pauses)
- git fetch && git rebase …             (fetch cannot pause)
- any single git command, however piped

Bypass: `Allow chained git bypass`, typed by the human in a genuine
user turn.

## Bypass

Bypass slug: `chained-git`. The grant phrase is typed by the operator; an agent relaying it never counts as a grant.
