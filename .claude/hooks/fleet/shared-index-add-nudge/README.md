# shared-index-add-nudge

PreToolUse(Bash) hook, non-blocking. **Warns** when a `git add` runs against an
index that already holds staged paths the add does not name.

## Why

The index is shared. In a checkout two agents work in, `git add <my paths>`
does not yield an index holding only those paths - it holds whatever the
co-session staged too, and the next `git commit` sweeps the lot under one
message.

Observed in this repo: a `git add` of six fleet paths landed in an index
already carrying another session's `package.json`, `pnpm-lock.yaml` and a
statusline entry point, staged minutes earlier by someone else.

## What to do

Commit named paths through an isolated index:

```
node scripts/fleet/commit-paths.mts -m <msg> <path>…
```

Nothing to do if the staged work is yours - the nudge cannot tell whose it is,
only that this `git add` did not name it.

## Scope

- Silent on a clean index, and silent when every staged path is covered by the
  add's own pathspecs.
- A sweeping form (`-A`, `--all`, `-u`, `--update`) covers everything, so it
  never nudges. Those flags are their own hazard, not this one's.
- Reads `git diff --cached --name-only` rather than guessing, and fails open
  when git cannot answer.
- Pathspec matching is conservative: a spec this cannot prove covers a file
  counts as not covering it, so the failure mode is a nudge nobody needed
  rather than silence in the case it exists for.
