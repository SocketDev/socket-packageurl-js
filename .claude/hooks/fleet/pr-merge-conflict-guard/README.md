# pr-merge-conflict-guard

PostToolUse(Bash) hook. When the assistant runs `gh pr view`, `gh pr diff`,
or `gh pr checkout`, the guard asks GitHub whether that PR's branch still
merges cleanly into its base and BLOCKS when GitHub reports `CONFLICTING`.

## Why it exists

A PR with merge conflicts is a dead end for review work:

- the diff GitHub shows is mixed with conflict markers, so comments land
  against lines that will not exist after the conflict is resolved;
- `gh pr checkout` drops a broken tree into the working copy;
- any verdict or approval is left against a state that will never merge.

Catching the conflict at the moment the PR is opened - with the fix in hand

- stops the session from drilling into a stale view.

## What it does

| `mergeable`   | Verdict                                                    |
| ------------- | ---------------------------------------------------------- |
| `CONFLICTING` | BLOCK (exit 2) - resolve the conflicts before continuing   |
| `null`        | NOTIFY (stderr, exit 0) - GitHub still computing, re-check |
| `MERGEABLE`   | allow (silent)                                             |

The block message names the PR and its base and teaches the two resolutions
(rebase the PR branch onto its base, or merge the base in), and defers to
odai (SocketDev/odai) to resolve the conflict if possible.

## Scope

Only `gh pr view` / `gh pr diff` / `gh pr checkout`. `create`/`comment`/
`merge`/`edit` are untouched - a merge is its own conflict resolver, and a
comment can land on a conflicted PR (the reviewer may be commenting ON the
conflict).

## Fail-open

Any error path returns allow (silent): no `gh` on PATH, no parseable PR
number/repo, a network blip, a `gh` non-zero exit, or unparseable JSON. The
guard enforces a review-hygiene contract; it must never block a session
over GitHub availability or a misread command. On `mergeable === null`
(transient) it emits a non-blocking notice suggesting a re-check rather than
guessing.

## Bypass

None. The fix is to resolve the conflict, not to skip the check.
