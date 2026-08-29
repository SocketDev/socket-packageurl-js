# reply-ref-link-guard

**Type:** Stop hook (GUARD - blocks). Global: it fires in any cwd.

## What it does

Blocks turn-end when the chat reply references a GitHub PR or issue as a
bare `#N`, or a Linear issue as a bare `TEAM-N` id. Outside GitHub's own
auto-linking surfaces a bare `#N` renders as dead text the owner cannot
click (CLAUDE.md "Status and reports": reference a PR or issue as a
clickable Markdown link), and a bare Linear id is dead text anywhere. The
rewrite is mechanical: a `[#N](…)` link to the pull, or a `[TEAM-N](…)`
link to the Linear issue - or backtick a literal that is not a reference:
a shard label, an ordinal, an acronym. The Linear scan carries a
denylist so standards that share the `CAPS-NUMBER` shape are not mistaken
for Linear ids.

Two-digit floor: a single digit after `#` is usually an ordinal ("the #1
priority"), and the references this rule exists for have long since
crossed #10. A ref already inside a markdown link (`[#123](…)`) never
fires, and code is exempt twice over - fenced blocks and inline spans are
both stripped before the scan.

No bypass: linking or backticking the ref always satisfies the guard, so
it can never deadlock against another Stop guard (the same argument that
keeps anti-prose-guard's reply path bypass-free).

## Bypass

None.
