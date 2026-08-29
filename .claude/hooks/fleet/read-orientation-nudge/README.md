# read-orientation-nudge

**Type:** PreToolUse hook (NUDGE - informational, never blocks).

## What it does

Context re-read across turns dominates model spend: a whole-file Read
accumulates in context and gets re-read on every later turn. When about to
read a LARGE source file WITHOUT an offset/limit (i.e. the whole thing), this
nudge orients the reader toward the file's symbol skeleton first, then a
span-scoped Read.

It UTILIZES the on-disk repo-map cache (`.repo-map/<rel>.skel`, warmed by the
SessionStart repo-map-refresh hook + the gen/repo-map `--write` runs): when a
FRESH skeleton already exists it points straight at that file (a ready-made,
~95%-smaller read - zero generation cost). Only when no fresh skeleton exists
does it fall back to suggesting `gen/repo-map --write` (which also warms the
cache for next time).

Advisory only - never blocks. Skips:
- non-Read tools
- a scoped read, offset or limit present - already reading a span
- small files, below the size threshold - nothing to save
- non-source files, since a skeleton is meaningless for prose/JSON/binaries
- a read of a `.skel` file itself, already the skeleton

## Bypass

None - it only prints informational text and cannot block or mutate anything.
