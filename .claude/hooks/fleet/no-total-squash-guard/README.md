# no-total-squash-guard

**Type:** PreToolUse hook (GUARD - blocks). Global: it fires in any cwd.

## What it does

Blocks a force push that would REPLACE a long stretch of remote history
with a SINGLE commit. That shape is almost always a misread of
"consolidate": consolidation means reducing history in a logical way -
grouping related commits and squashing within groups - not collapsing
everything since a release into one commit. A many→1 rewrite of a shared
branch destroys the grouped history that makes bisects, reverts, and
release notes possible.

Detection: for a `git push` carrying any force flag, each destination
branch is compared against its remote-tracking ref. If the remote side
has ≥ MIN_REPLACED commits past the merge-base while the local side adds
exactly one, the push is a total squash and blocks.

Sanctioned paths through:
- The `squashing-history` skill (mirror-squash of a squashed-remote
repo) sets the SQUASH_HISTORY sentinel - see
`_shared/squash-sentinel.mts` - and passes: that flow byte-verifies
the tree against a backup branch first, and a single commit IS its
contract.
- The user types the exact phrase `Allow total squash bypass`.

A grouped consolidation (many→several logical commits) never triggers
this guard - only many→1 does.

Fails open on git errors / detached refs / missing remote-tracking refs:
the guard protects a specific hazardous shape, it is not a general
force-push gate, that's no-force-push-guard's job.

Reads a Claude Code PreToolUse JSON payload from stdin:
{ "tool_name": "Bash",
"tool_input": { "command": "..." },
"cwd": "/repo",
"transcript_path": "/.../session.jsonl" }

## Bypass

Bypass slug: `total-squash`. The grant phrase is typed by the operator; an agent relaying it never counts as a grant.
