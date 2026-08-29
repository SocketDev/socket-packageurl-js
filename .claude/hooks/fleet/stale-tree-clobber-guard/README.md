# stale-tree-clobber-guard

**Type:** PreToolUse hook (GUARD - blocks).

## What it does

WHY THIS EXISTS. Three landings on 2026-07-30 silently reverted work
nobody meant to touch. Two of them ate the same one-line fix
(`pnpm_config_store_dir`, plus the assertion proving the pin took effect)
in `.github/actions/fleet/setup-and-install/action.yml` and its
`template/base/` twin:

688e1408f  fix(test-collection): conformance-tier files are owned, not orphans
e987c0a95  chore(wheelhouse): mirror the skill and doc updates into the live tree
6e6c296f0  docs(claude-md): index the persistent sfw CA rule  (same class,
different victim: silently dropped 16 lines from
docs/agents.md/fleet/adversarial-self-review.md)

None was a blanket sweep. All three were small, scoped, correctly authored
commits, and `cascade-and-land.mts` already forbids `git add -A`. The
clobbered paths were never edited by their authors and are nowhere near
the subject line. What happened is simpler: a session held a working tree
long enough for another session to land a newer version of a file, then
committed its own stale copy of that file on top.

The existing staging guards cannot see this. `overeager-staging-guard`
asks WHOSE file is in the index; this asks WHICH VERSION is in the index.
A file can be correctly yours, correctly staged, correctly scoped - and
still be older than HEAD. Note too that `overeager-staging-guard` relaxes
itself entirely in a `squash-history` repo, which socket-wheelhouse is, so
nothing was covering this repo. This guard does NOT take that relaxation:
commit granularity is meaningless under squash, but content loss is
permanent either way.

DOCTRINE - this adds no new rule, it enforces one already written down.
See `docs/agents.md/fleet/parallel-claude-sessions.md` ("Reconcile
FORWARD, never rewind"; "Leave it, or land it") and the squash-history
advice `.git-hooks/fleet/pre-push.mts` already prints: local main is
canonical and flattens, so a parallel session's newer content is something
to LAND, not something to work around, wait out, or revert. Three
consequences the block message repeats rather than reinventing:

1. Land forward. Take HEAD's newer version for the paths you did not
mean to change, and land everything else in the same breath. Nothing
is held back and nothing is reverted.
2. Do not hold a working tree across another session's landings. In a
land-fast repo the staleness window should barely exist.
3. Land the dirty files BEFORE squashing. A squash over an uncommitted
tree either sweeps that work under someone else's subject or strands
it. Commit first, then squash - never the reverse.

Stashing, branching, waiting for a quiet window, and retreating into a
private worktree are all the wrong instinct here, and the message says so.

DETECTION. For each staged MODIFICATION, compare the staged blob against
HEAD's blob for that path:

Primary, history-free - a deletion-dominant change: it removes at least
MIN_DELETED_LINES lines HEAD has and puts back no more than
MAX_ADD_RATIO of them. That is "removes content HEAD has, adds nothing
in its place". It holds whether or not history survives, which matters
because this repo squashes its history flat and a deep per-path walk can
return nothing at all.

Corroboration, bounded and optional - when the staged blob is
byte-identical to an older version of that same path within
HISTORY_LOOKBACK commits, the rollback is proven rather than inferred.
Replayed over the 654 non-revert commits preceding the incident, the
corroborated pair fires on 7: the 3 real clobbers above, 2 machine
cascade syncs (already exempt via the `FLEET_SYNC=1` sentinel), and 2
genuine refactors. Two false positives in 654 commits.

When the lookback finds NO prior version - history was just flattened -
the primary signal stands alone, narrowed to paths this session never
authored. An uncorroborated fire on a file you did edit is noise; on a
file you never touched it is the exact shape of the bug.

Exempt: the `FLEET_SYNC=1` cascade sentinel (a mirror sync legitimately
rewrites live files from the template), the `SQUASH_HISTORY=1` sentinel, an
explicit `revert`-subject commit, a `git revert` in progress, and binary
blobs. Generated artifacts are not special-cased - they reach the index
through the cascade, which the sentinel already covers.

Blocks (exit 2). Fails open on hook bugs (exit 0 + stderr log).

Bypass: `Allow stale-tree bypass` in a recent user turn.

Reads a Claude Code PreToolUse JSON payload from stdin:
{ "tool_name": "Bash",
"tool_input": { "command": "..." },
"transcript_path": "/.../session.jsonl" }

## Bypass

Bypass slug: `stale-tree`. The grant phrase is typed by the operator; an agent relaying it never counts as a grant.
