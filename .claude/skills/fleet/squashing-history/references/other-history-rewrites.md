# Other history rewrites

This skill collapses history. For the two other rewrite shapes, the deterministic
owners already exist - never hand-roll one:

- **Strip AI attribution from a range of messages:**
  `node scripts/fleet/strip-ai-tags.mts --base <ref> [--dry-run]`. It walks
  `base..HEAD` with plumbing, rewords only flagged messages, preserves tree +
  author identity + author date, signs each commit, and verifies the final tree
  byte-identical.
- **Regroup a span into logical commits:** `scripts/fleet/consolidate-commits.mts`.

`history-rewrite-guard` blocks `git filter-branch` / `git filter-repo` / an
unsigned `git commit-tree` - they re-mint commits unsigned, and `filter-branch`
restores the original `GIT_COMMITTER_*`, so even a re-signed commit fails
GitHub's verification. See [`history-rewrites`](../../../../../docs/agents.md/fleet/history-rewrites.md).
