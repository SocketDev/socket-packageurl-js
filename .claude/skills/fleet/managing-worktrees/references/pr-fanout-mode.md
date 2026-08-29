# Mode 2: `pr-fanout`

For each open PR on the current GitHub repo, ensure a worktree exists at `../<repo>-pr-<num>/`. Idempotent: skip PRs whose worktree already exists.

<details>
<summary><b>Detail</b> - `gh auth`, `REPO_NAME=$(basename`, `gh pr`</summary>

```bash
gh auth status >/dev/null  # fail loudly if not authenticated
REPO_NAME=$(basename "$(git rev-parse --show-toplevel)")

gh pr list --json number,headRefName --jq '.[]' | while read -r pr_json; do
  PR=$(echo "$pr_json" | jq -r '.number')
  BRANCH=$(echo "$pr_json" | jq -r '.headRefName')
  WORKTREE_PATH="../${REPO_NAME}-pr-${PR}"

  if [ -d "$WORKTREE_PATH" ]; then
    echo "= pr-${PR} already at $WORKTREE_PATH"
    continue
  fi

  git fetch origin "$BRANCH:refs/remotes/origin/$BRANCH" 2>/dev/null
  git worktree add "$WORKTREE_PATH" "origin/$BRANCH"
  echo "+ pr-${PR} (branch $BRANCH) → $WORKTREE_PATH"
done

git worktree list
```

This is the multi-Claude review setup: each open PR gets its own checkout so a parallel session can take one without contention.

</details>
