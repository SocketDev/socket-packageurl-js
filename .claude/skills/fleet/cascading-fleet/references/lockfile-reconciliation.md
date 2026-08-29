# Post-cascade: reconcile lockfiles (in parallel)

🚨 A cascade that changes the catalog (`pnpm-workspace.yaml`), `packageManager`, or dep overrides lands a **lockfile-less** commit downstream --the worktree's `pnpm-lock.yaml` regenerates locally but is excluded from the cascade commit. Downstream CI runs `pnpm install --frozen-lockfile`, so a stale lockfile **red-lines every consumer**. The cascade is not done until each affected repo's lockfile is reconciled.

This is a parallel fleet operation, so it is **a Workflow, not a shell loop** (`for r in …; do … & done; wait` races - multiple instances land on one repo and orphan worktrees). Two layered surfaces, executable-first:

1. **The per-repo executable (the law):** `lib/reconcile-lockfiles.mts` - worktrees off the repo default branch, runs `pnpm install` (repo-pinned pnpm) to regenerate the lockfile against the cascaded catalog, and IF it changed commits `chore(wheelhouse): reconcile pnpm-lock.yaml after cascade` (FLEET_SYNC sentinel) + pushes, then force-removes its worktree. Idempotent - a repo already current reports `noop:lockfile-current` and pushes nothing. Scope to one repo with `--skip <all-others>`.
2. **The fan-out (the orchestrator):** the saved Workflow `reconcile-fleet-lockfiles` (`.claude/workflows/reconcile-fleet-lockfiles.js`) runs surface 1 once per repo in parallel - bounded concurrency, one task per repo, structured results, no leaked PIDs. Run it after a catalog cascade:

```
Workflow({ name: 'reconcile-fleet-lockfiles' })                 # whole roster (already-current repos no-op)
Workflow({ name: 'reconcile-fleet-lockfiles', args: ['socket-lib', 'sdxgen'] })   # only the cascade's targets
```

Because surface 1 is idempotent, running the whole roster is safe; pass `args`, a repo-name array or `{ only, skip }`, to narrow to just the repos a cascade touched. Local/experimental workflow scripts save to `~/.claude/workflows/` - the repo's `.claude/workflows/` is fleet-owned and delete-and-replace mirrored.
