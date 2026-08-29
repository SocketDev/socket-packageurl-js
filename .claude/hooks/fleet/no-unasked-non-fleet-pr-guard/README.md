# no-unasked-non-fleet-pr-guard

**Type:** PreToolUse hook (GUARD - blocks). Global: it fires in any cwd.

## What it does

Blocks `gh pr create` against a repository that is NOT a fleet member until
the operator has said yes for that repo. Pushing the branch stays free; it is
opening the PR that needs a word, because in someone else's repo a PR is not
a private artifact: it summons reviewers, spends their CI, notifies
CODEOWNERS, and cannot be taken back cleanly - GitHub's reopen can refuse
outright, so "just close it" is not a safe undo.

Why non-fleet specifically: inside the fleet, opening a PR is how work lands
and the roster repos are ours to churn. Outside it the agent is a guest. A
"do it" about the WORK gets read as authorization to FILE, which is how two
unrequested PRs landed on a team repo (2026-08-10) - one of which belonged in
the fleet template rather than in that product at all. The move there was:
push the branch, describe the PR, wait.

Detection rides the shared `gh pr create` parser
(`_shared/gh-pr-command.mts`), never a regex, so `&&` chains, quoting, and a
literal "gh pr create" inside a `--body` cannot false-fire. Drafts count: a
draft still creates the PR and its notifications.

`gh pr create` is not the only way to open a PR, and a guard that covers
just it teaches the agent to route around the guard, so the other two
vectors are covered too:
- REST: `gh api repos/{owner}/{repo}/pulls` with an explicit `-X POST`,
or with `-f`/`-F` fields (which make gh POST implicitly). An explicit
`-X GET` stays read-only. The endpoint path names the target repo, so
detection and target resolution come from the same argument.
- GraphQL: `gh api graphql` whose arguments carry `createPullRequest`.
The mutation takes a repository node id, not a slug, so the target
falls back to the origin of the directory the command runs in - and,
unresolvable, fails OPEN like the base case.
`hub pull-request` is intentionally NOT covered: hub is not installed on
fleet machines, and an agent inventive enough to install it has more
general supply-chain guards to answer to first.

Target resolution, in priority order:
1. `--repo` / `-R owner/name` on the command
2. the REST endpoint's `{owner}/{repo}` path segments
3. the origin remote of the directory the command runs in (`cd x && gh …`,
else the session cwd)

Fires everywhere via `global: true` - a non-fleet repo is exactly where this
has to work, so it cannot be scoped to fleet checkouts.

Bypass: `Allow non-fleet-pr bypass: <repo>` typed verbatim in a recent user
turn. The scoped form names one repo, so a yes for one cannot leak to another.

Fails OPEN on ambiguity (no parseable command, no resolvable repo): a guard
that blocks a legitimate PR is worse than one that misses a case.

## Bypass

Bypass slug: `non-fleet-pr`. The grant phrase is typed by the operator; an agent relaying it never counts as a grant.
