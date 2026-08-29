# latest-release-pin-guard

**Type:** PreToolUse hook (GUARD - blocks).

## What it does

BLOCKS an Edit/Write to `.gitmodules` or a `*lockstep.json` manifest that
SETS or CHANGES an upstream pin to something OLDER than the newest shipped
release tag. Porting an upstream means the LATEST release - always. A pin left
at a stale/inherited release is a work-loss trap: the opentui incident pinned
v0.1.99, 211 commits and 3 minor releases behind v0.4.5, and ~31k lines were
ported against it before anyone noticed.

What it checks, per changed pin:
- `.gitmodules`    - a `[submodule "…"]` block's `ref`/`branch` pin.
- `*lockstep.json` - a version-pin row's `pinned_sha`/`pinned_tag`; the
upstream repo URL is resolved from the manifest's `upstreams` map.
It fetches the upstream's tags with `git ls-remote --tags <url>`, finds the
newest STABLE tag sharing the pin's version scheme, and blocks when the pin
resolves to an older one - naming the newer release. Only pins that are NEW or
whose value CHANGED in this edit are checked: the post-edit text via
`resolveEditedText` is diffed against the on-disk file, so touching an
unrelated field never false-blocks a pin already committed.

Fails OPEN on anything it can't determine - an offline `ls-remote`, an
unparseable tag scheme, a sha that maps to no release tag, a fragment edit
whose post-edit text can't be reconstructed. The CI-side lockstep drift check
(`scripts/fleet/lockstep/checks.mts`) is the online backstop.

Convention: docs/agents.md/fleet/lockstep.md + docs/agents.md/fleet/drift-watch.md.
Bypass: `Allow latest-release-pin bypass`.

## Bypass

Bypass slug: `latest-release-pin`. The grant phrase is typed by the operator; an agent relaying it never counts as a grant.
