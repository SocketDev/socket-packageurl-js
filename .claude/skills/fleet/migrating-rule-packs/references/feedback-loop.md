# PR-review feedback as rule rewrites

Every merged PR's review comments get rewritten back into the rule files as a NEW commit on the rule-pack. This is the feedback loop that makes the rule pack improve over time - the human reviewer's diff suggestions become the next iteration's "When the rule does NOT apply" entries.

Workflow:

1. Reviewer leaves an inline comment on a migration PR ("don't use Type.Number() for IDs - use Type.Integer() with constraints").
2. Skill operator updates the relevant rule file with the new exception.
3. Remaining open migration PRs receive the rule-pack update via `git pull` in their worktrees; they re-run the loop from scratch.

The rule pack is wet cement until the migration completes; the last PR's rules are the final form. After the migration lands, the operator may promote the stable rules to an oxlint rule or a `.claude/hooks/` guard (per CLAUDE.md _Compound lessons_).
