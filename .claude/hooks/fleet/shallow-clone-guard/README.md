# shallow-clone-guard

**Type:** PreToolUse hook (GUARD - blocks).

## What it does

BLOCKS any Bash `git clone …` that lacks BOTH `--depth=1` (or `--depth 1`)
AND `--single-branch`. A bare `git clone <url>` fetches the full object
graph for every branch - unnecessary for review work, slow, and a larger
attack surface than a bounded shallow clone.

`git clone --help` and `git clone -h` are information queries that download
nothing and are always allowed.

Detection, shell-command tokenized, not a raw regex: the command invokes
`git` with `clone` as its SUBCOMMAND (`_shared/git-subcommand.mts`, which
skips a global option's separate value token so `git -C /repo clone <url>`
resolves to `clone` and not to `/repo`); `--help`/`-h` exempt it; hasDepth1
is true when `--depth=1` appears OR `--depth` is followed by `1` as a
separate token; hasSingleBranch is true when `--single-branch` appears.
The guard fires when either flag is missing.

Fails open on parse / payload errors - a guard bug must not block every Bash
call.

## Bypass

Bypass slug: `shallow-clone`. The grant phrase is typed by the operator; an agent relaying it never counts as a grant.
