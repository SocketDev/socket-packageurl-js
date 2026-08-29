# issue-autolink-nudge

**Type:** PreToolUse hook (NUDGE - informational, never blocks). Global: it fires in any cwd.

## What it does

On a Bash command that writes to a public Git or GitHub surface (a commit,
or a pr, issue, comment, or release body), warn when the text contains a
bare `#N`. GitHub auto-links `#3` into a reference to issue or PR 3 of the
target repo - so a `#3` that meant "list item 3" or "task 3" silently turns
into a cross-reference to an unrelated issue. Suggest backticking it
(`` `#3` ``) or reshaping ("item 3").

Advisory only - a bare `#N` is sometimes a deliberate, correct reference.
The nudge just prompts the author to confirm intent before it sends. Never
blocks (notify, exit 0). Universal: bare `#N` auto-links on ANY GitHub repo,
so this is not fleet-scoped. Internal task lists in the agent's own prose
never sent to a public surface, are unaffected.

## Bypass

None - it only prints informational text and cannot block or mutate anything.
