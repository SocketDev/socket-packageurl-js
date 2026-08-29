# no-copyleft-source-read

**Type:** PreToolUse hook (GUARD - blocks).

## What it does

BLOCKS every route an agent has to the IMPLEMENTATION of a copyleft upstream.
A copyleft project may be RUN as a tool and OBSERVED through its own tests -
behavior is not implementation - but reading, copying, or deriving from its
source makes the consuming package a derivative work and forces the
upstream's license onto it. The roster, the tests allowlist, and the matcher
all live in `_shared/copyleft-upstreams.mts`, which the commit-time belt
`copyleft-slices-are-tests-only.mts` shares, so guard and gate cannot drift.

STRUCTURE IS NOT CONTENT. A directory tree - paths, file names, blob shas,
counts - is FACT, not expression, and copyright does not reach it. Only the
code itself is off limits. So enumeration is ALLOWED everywhere and only
content reads are blocked. Conflating the two is not merely over-strict, it
is actively harmful: it blocks the very listing needed to verify that a
roster entry's tests allowlist matches the upstream's real test corpus, so
the guard's own data silently rots behind the guard.

ALLOWED - enumeration, yields paths and names, never file bytes:
- `ls` at any depth, `tree`, `find` with name-style output.
- `git ls-tree` / `git ls-files`; a blob sha names a blob, it is not one.
- `gh api repos/<o>/<r>/git/trees/<sha>` - the remote tree listing.
- The Glob tool; its results ARE paths, including a bare submodule-root
pattern such as `upstream/<repo>/**`.
- Read of a DIRECTORY, which yields an entry listing rather than content.
- `rg -l` / `grep -l` / `--files-with-matches` / `--count` - path-only
output. See docs/agents.md/fleet/copyleft-boundaries.md for why the
theoretical content-oracle in `-l` is accepted rather than blocked.

BLOCKED - content:
- Read of a non-test FILE under `upstream/<repo>/`.
- `cat` / `head` / `tail` / `less` / `strings` and equivalents on a
non-test file, whether named directly or reached by a leading `cd`.
- `rg` / `grep` in default LINE-PRINTING mode against a non-test scope;
matching lines are content. The Grep tool likewise blocks only when
`output_mode` is `content`.
- `find … -exec`/`-execdir`/`-ok`, which runs an arbitrary reader per hit.
- `git show <rev>:<non-test-path>`, `git cat-file` of a non-test blob, and
`git archive`. `git show HEAD:<dir>` prints a tree listing rather than
content, but the guard cannot tell a dir from a file in a rev-spec, so it
stays blocked and `git ls-tree` is the sanctioned enumeration route.
- `gh api repos/<owner>/<repo>/contents/<path>` for a non-test path.
- `curl` / `wget` against `raw.githubusercontent.com`, a
`github.com/<o>/<r>/{blob,raw}` file view, or a whole-tree archive from
`codeload.github.com` / `/archive` / `/tarball` / `/zipball`.
- `git sparse-checkout set|add|disable|reapply` that would WIDEN a copyleft
submodule's cone past its tests allowlist. This is the route that matters
most: widening the cone materializes the implementation on disk, after
which every later read looks like an ordinary local file.
- WebFetch of the same URLs. WebSearch carries a query, not a fetchable
URL, so there is nothing for this guard to match on it; the URL its
results lead to arrives as a WebFetch and is gated there.

Fails open on parse errors - a guard bug must never block a session.

Convention: docs/agents.md/fleet/copyleft-boundaries.md.
Bypass: `Allow copyleft-source-read bypass`.

## Bypass

Bypass slug: `copyleft-source-read`. The grant phrase is typed by the operator; an agent relaying it never counts as a grant.
