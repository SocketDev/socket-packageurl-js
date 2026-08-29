# Staying at one commit after a cascade

Once a repo is a single `chore: initial commit`, the wheelhouse cascade keeps it that way:
`sync-scaffolding` detects the lone-initial-commit shape (`isSingleInitialCommit` in
`scripts/repo/sync-scaffolding/commit.mts`) and **amends** the cascade into that commit
(`git commit --amend --no-edit`) rather than stacking a `chore(wheelhouse): cascade …` on top. So a
squashed repo doesn't drift back to multi-commit between manual squashes - no re-squash needed after
routine cascades.
