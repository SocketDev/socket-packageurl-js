## Acceptance for the skill itself

- This SKILL.md exists ✓ (you're reading it).
- The operational runner `lib/run-migration.mts` is built ✓ and the SKILL thin-wraps it.
- The first real migration runs through it end-to-end; record the actual speedup vs. estimated serial time wherever the operator tracks it.

## Precedent

The cascade orchestrator (`template/.claude/skills/fleet/cascading-fleet/lib/cascade-template.mts`) already does parallel-worktree execution across the fleet. Pattern is "lift cascade's runtime for migrations" - same worktree convention, same per-target commit shape, different inner loop.

Related fleet skills:

- `cascading-fleet` - propagate one wheelhouse SHA to every fleet repo, this skill's parent pattern.
- `refactor-cleaner` (agent) - for non-mechanical refactors that need per-call-site human judgment.
- `looping-quality` - for in-repo cleanup waves; rule-pack migrations are the cross-repo / cross-file generalization.
