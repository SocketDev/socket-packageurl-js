# prefer-mcp-server-nudge

**Type:** PreToolUse hook (NUDGE - informational, never blocks).

## What it does

Five MCP servers besides fff answer questions a session otherwise answers the
hard way: Linear, Notion, Playwright, refero, and janus. Each one is wired
already. Linear
and Notion arrive as a claude.ai connector or as an `.mcp.json` project
server; refero and janus arrive as project servers in the cascaded
`.mcp.json`. So their tools sit in every session's tool list, and being wired
is not the same as being reached for:
the sibling `prefer-mcp-search-nudge` exists because one session shelled out
to `rg` 603 times and called the fff tools zero times, and the same gap opens
on every other server.

Reaching a server the hard way costs three things the structured tools do not:
- The page behind the URL is rendered HTML behind a login, so a fetch gets
a sign-in wall or a JS shell rather than the record.
- Fields arrive as prose to re-parse instead of typed values, so an issue
state or a screen's palette has to be read back out of markup.
- Writes have no path at all. A fetch can read a page; only the tools can
save a comment, move a status, or create a ticket.

ONE table-driven hook, not four near-identical directories. Every row in
MCP_SERVERS names the server, the tool prefixes that reach it, and the signal
that means the hard way was taken. A fifth server is a row.

Stderr reminder; never blocks. Both tool prefixes are listed per server
because a project `.mcp.json` entry SHADOWS the claude.ai connector when both
name the same service, so which prefix arrives depends on the checkout rather
than on anything this hook can see.

Scope: Bash (a URL anywhere among the command's real arguments, plus the
`janus` binary at a command position) and WebFetch (its `url` input). Skipped:
- a URL inside a `git commit -m` / `gh --body` prose value - a mention of a
ticket, not a reach for it;
- a bare host carrying neither a scheme nor a path (`linear.app` written in
a sentence or handed to a search as a pattern);
- a host that merely starts with a target host (`notionfake.com`).

## Bypass

None - it only prints informational text and cannot block or mutate anything.
