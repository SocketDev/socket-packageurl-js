# prefer-script-emission-guard

**Type:** PostToolUse hook (GUARD - blocks). Global: it fires in any cwd.

## What it does

The EMISSION-side twin of the raw-command guards (no-raw-gh-auth-login-guard,
no-direct-linter-guard): blocks a reply that tells the OPERATOR to run a raw
command the repo already wraps in a script.

Why the bash-side guard is not enough: it watches the Bash tool, and prose is
not a tool call. An agent that writes "run `gh auth login` to re-auth" has
routed the operator around the wrapper without invoking anything, and the
operator then hits the exact failure the wrapper prevents - a login that
lands the token in ~/.config/gh/hosts.yml, or one missing the scopes the very
next ghcr read needs. That happened: a session reported a dead credential and
handed over the raw command, while `pnpm run gh:auth login` sat unmentioned.

The table lives in `_shared/script-redirects.mts` and both surfaces read it,
so a redirect cannot hold on one and go missing on the other.

Does NOT fire when the reply also names the script. A reply carrying both is
contrasting them - documenting the rule, or explaining why the raw form is
wrong - and blocking that would make the rule impossible to write about.

Bypass: `Allow raw-command bypass`, for the rare reply that must quote the
raw form alone. A bug report about the wrapper itself is the case.

## Bypass

Bypass slug: `raw-command`. The grant phrase is typed by the operator; an agent relaying it never counts as a grant.
