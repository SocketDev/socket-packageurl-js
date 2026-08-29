---
name: writing-handoffs
description: Write a handoff doc under .claude/reports and report its absolute path.
user-invocable: true
# Mechanical: it assembles a doc from state the session already has.
model: haiku
allowed-tools: Read, Edit, Write, Glob, Grep, Bash(node scripts/fleet/write-handoff.mts:*), Bash(node scripts/fleet/consolidate-reports.mts:*), Bash(git:*), Bash(ls:*)
metadata:
  internal: true
---

# writing-handoffs

"Write a handoff doc" means **produce a file**. The failing reading summarizes
in chat, and that summary scrolls out of the context window it was meant to
outlive. A handoff exists to be opened by the session after the one that wrote
it. `handoff-request-guard` (Stop hook) blocks the turn from ending until the
document exists and its absolute path is reported.

## Do this

```sh
node scripts/fleet/write-handoff.mts <slug>
```

It mints `.claude/reports/YYYY-MM-DD-<slug>-handoff.md` from a scaffold and
prints the absolute path on stdout, alone, so it can be piped. Then fill the
scaffold in and report that path.

If a report for the slug already exists, the script prints the existing path
instead of minting a second file. **Edit that file.** One report split across
two files is the exact condition `consolidate-reports.mts` exists to complain
about. Pass `--new` only when a second document is deliberate.

## Report the ABSOLUTE path

Not a formatting preference. The reports tree is gitignored, so
`reports/x.md` is unresolvable for a reader who does not already know which
checkout the session was rooted in, and sessions here routinely span several at
once: a wheelhouse, a member, a `/tmp` worktree. A relative path names a file
the reader cannot open.

## What makes a handoff worth writing

The scaffold's sections exist because a handoff that omits them sends the next
session back through work already done:

- **Short version** - the state, and the first thing the next actor should do.
- **What is already done** - with the evidence that proves it, so it is not
  redone. Prefer a command and its output over an assertion.
- **What is left** - concrete steps, in order.
- **Mechanics that will bite** - ordering constraints, laws that fire on a
  partial change, concurrent actors, anything learned the hard way. This is
  usually the highest-value section and the one most often skipped.
- **Verification** - the commands that prove the state, so the reader can
  confirm rather than trust.
- **Also open** - adjacent things noticed and deliberately not done, with why.

Write what a competent stranger needs, not what you remember. Name files by
path, commits by SHA, and findings by the command that produced them.

## Do not

- Do not describe work you did not verify. If a step was skipped or a check was
  not run, say so in the document.
- Do not leave a section as scaffold prose. Delete a section that does not
  apply rather than shipping its placeholder.
- Do not mint an undated name by hand. The script owns the naming convention,
  and 113 of the tree's existing reports lack a date prefix precisely because
  it was done by hand.
