# handoff-request-guard

Stop hook. **BLOCKS** ending a turn when the most recent human turn asked for a
handoff document **and** the reply hands back no absolute path to one under
`.claude/reports/`.

"Write a handoff doc" is an instruction to produce a file. The failing reading
summarizes in chat instead, and that summary scrolls out of the context window
it was meant to outlive. A handoff exists to be opened by the session after the
one that wrote it.

## The absolute path is part of the deliverable

Not a formatting preference. The reports tree is gitignored, so `reports/x.md`
is unresolvable for a reader who does not already know which checkout the
session was rooted in, and sessions here routinely span several at once: a
wheelhouse, a member, a `/tmp` worktree. A relative path names a file the
reader cannot open.

A reply citing only a relative path gets a different message from one citing no
path at all, because writing the document and then pointing at it unusably is a
different mistake from never writing it.

## Why Stop and not PreToolUse

Gathering what a handoff needs takes tool calls. A PreToolUse gate would block
the research it is asking for. This hook lets the turn do the work and refuses
to END until the document exists.

## Writing one

```sh
node scripts/fleet/write-handoff.mts <slug>
```

That mints `.claude/reports/YYYY-MM-DD-<slug>-handoff.md` from a scaffold and
prints its absolute path on stdout, alone, so it can be piped. It refuses to
create a second file for a slug that already exists, printing the existing path
instead, because one report split across two files is the exact condition
`consolidate-reports.mts` exists to complain about. Pass `--new` when the second
document is deliberate.

## Bypass

`Allow handoff-request bypass`, for when the ask was rhetorical or the document
belongs somewhere this guard cannot see.
