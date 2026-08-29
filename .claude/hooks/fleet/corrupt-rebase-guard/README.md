# corrupt-rebase-guard

**Type:** PreToolUse hook (GUARD - blocks).

## What it does

Blocks `--continue` / `--skip` for any paused sequencer (cherry-pick, merge,
rebase, revert) whose index holds a wipe. Observed live: a rebase stopped in
a shared checkout with 8,006 files staged for deletion while the commit it
was applying touched 2. Continuing would have recorded that onto the branch.

Every verb reads its OWN pseudo-ref for the stopped commit. Reading
`REBASE_HEAD` for all of them looks like it works - the volume check still
fires - while the disproportion signal is dead for three verbs, which is the
half that catches a corrupt index below the deletion floor.

Why the deletion gates that already exist did not catch it: every one of
them keys on `git commit`. `--continue` records a commit through git's own
machinery and never spells that word, so it walked straight past
mass-delete-guard and the .git-hooks staged gate. The hole was the command
name, not the detection.

The judgment lives in `rebase-shape.mts` (pure, unit-tested). This file only
gathers the two counts: staged deletions now, and the file count of the
commit the rebase stopped on. `--abort` is never blocked - it is the
recovery path out of exactly the state this guard reports.

## Bypass

Bypass slug: `corrupt-rebase`. The grant phrase is typed by the operator; an agent relaying it never counts as a grant.
