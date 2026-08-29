# commit-paths-are-named-guard

**Type:** PreToolUse hook (GUARD - blocks).

## What it does

Refuses a `commit-paths` invocation whose path list is computed from a tree
walk - `$(git status --porcelain | ...)`, `$(git diff --name-only)`,
`$(git ls-files)`, `$(find ...)`, or a pipe into `xargs`.

A substitution that produces a MESSAGE is fine. `-F /tmp/msg.txt` and
`-m "$(cat notes)"` both pass, because the detector looks for the enumerating
command rather than for `$(` on its own.

## Why it exists

`commit-paths` has one job: commit only the paths you named, through an isolated
index, so a parallel session's staged work cannot ride along. A computed path
list defeats that completely. It becomes `git add -A` with extra steps, and the
message then describes one change while the commit carries three.

A commit landed on wheelhouse main labelled `dogfood artifact-gates-on-stop`
carrying another session's submodule work and an unrelated comment edit. The
invocation was:

```sh
commit-paths -m "..." $(git status --porcelain | awk '{print $NF}')
```

The tool built to stop that sweep was handed the sweep as its argument. Nothing
refused it, so this does.

## Fix

Name the paths. If the list is long enough that naming it feels tedious, that is
the signal the commit is doing more than one thing.

## Bypass

None. A commit that needs the whole dirty set is `git add -A`, and it should say
so in its own message.
