# repo-map-refresh

**Type:** SessionStart hook (NUDGE - informational, never blocks).

## What it does

Keeps the on-disk repo-map cache (.repo-map/<rel>.skel) warm so the
read-orientation-nudge hook can point a model straight at a ready-made,
~95%-smaller skeleton instead of a whole-file read (context re-read dominates
spend). Runs the CHEAP incremental refresh - `gen/repo-map --write
--changed` - which only re-skeletons git-touched source files.

Cold caches SEED, warm caches refresh: when `.repo-map/` already exists the
hook runs the cheap incremental `--changed` pass; when it is absent it runs
the full first build instead. Both spawn detached, so neither costs the
session anything - the incremental-only design left every fleet member's
cache permanently cold, because nothing else ever performed the first build
(audited 2026-08-05: 12/12 members had the machinery wired and a cold cache).

**Fail-open**: spawned DETACHED + unref'd with stdio ignored, so it adds zero
session latency and any error, no git, missing script, spawn failure, is
swallowed - the session proceeds with a possibly-staler cache, never a break.

## Bypass

None - it only prints informational text and cannot block or mutate anything.
