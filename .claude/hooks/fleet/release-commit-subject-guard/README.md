# release-commit-subject-guard

**Type:** PreToolUse hook (GUARD - blocks).

## What it does

Blocks a `git commit` whose RELEASE subject carries anything past the
version. A release subject is exactly `chore(release): X.Y.Z` - nothing
else. A subject this refuses, and the shape that motivated it:

chore(release): 1.1.151 - 1.1.150 burned on the shim-wrapped stage 403

Release history is a version ledger. Tooling greps it for the previous
release, changelog generators key off it, and humans scan it for "which
version was that". A rationale clause in the subject makes the ledger a
narrative: the line no longer parses as a version marker, and the story it
tells is about a FAILED attempt, which is not what the release is.

Where that story belongs: the commit BODY, the changelog entry, or the PR.
All three are read by someone looking for the why; the subject is read by
someone looking for the version.

PreToolUse at the tool layer, like the ai-attribution guard, so it also
covers non-fleet repos with no fleet git hooks - the subject is written
by an agent composing the command, and that is the moment to catch it.

Bypass: `Allow release-subject bypass`.

## Bypass

Bypass slug: `release-subject`. The grant phrase is typed by the operator; an agent relaying it never counts as a grant.
