# bot-comment-collapse-guard

**Type:** Stop hook (GUARD - blocks). Global: it fires in any cwd.

## What it does

"Resolve the bot comments" means the FULL visual collapse: resolving the
review threads AND minimizing the bot's top-level review summaries /
comments as RESOLVED. Sessions kept doing only the first half - resolved
threads auto-collapse, but a review bot's "found N issues" summary body
does NOT, and stays loud on the PR page (depscan #23256 / #23218,
2026-07-24: the operator had to ask repeatedly).

Detection is code-is-law: the guard scans this session's Bash tool calls
for `resolveReviewThread` mutations, maps the `PRRT_…` thread ids to
their pull requests via a `gh api graphql` node lookup, then queries each
PR's LIVE state for bot-authored, un-minimized reviews and issue
comments. GitHub is the source of truth - a session that minimized in a
later command, or resolved threads on a PR whose bot summaries were
already collapsed, passes without ceremony.

Blocks the Stop while violations remain; the message carries the
`hide-comments.mts` command per PR. Fails open on gh /
network / parse errors (the guard enforces a hygiene contract, it must
never block a session over GitHub availability).

Bypass: `Allow bot-collapse bypass`.

## Bypass

Bypass slug: `bot-collapse`. The grant phrase is typed by the operator; an agent relaying it never counts as a grant.
