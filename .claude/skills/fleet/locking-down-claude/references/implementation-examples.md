# Implementation examples

## Reference implementation

`socket-lib/tools/prim/src/disambiguate.mts`: canonical SDK-form callsite. The file header documents each flag against the eval-flow step it enforces.

`socket-lib/tools/prim/test/disambiguate.test.mts`: source-text guards that fail the build if `BASE_TOOLS` widens, if `tools: BASE_TOOLS` is unwired, if `permissionMode` drifts from `'dontAsk'`, or if `bypassPermissions` / `allowDangerouslySkipPermissions: true` ever appears. Mirror this pattern in any new callsite.

## Existing fleet callsites

- `scripts/fleet/ai-lint-fix/claude.mts`: `runClaudeFix()` spawns the edit-only agent per file via `spawnAiAgent({ ...AI_PROFILE.edit })`, the locked-down four-flag wrapper - model and effort picked per-file by the caller's `escalateTier()`.
- `socket-registry/.github/workflows/weekly-update.md`: the gh-aw reusable workflow (`engine: claude`, `max-ai-credits`, network allowlist, safe-output PR). Replaced the legacy `claude --print` reusable.
- `socket-lib/tools/prim/src/disambiguate.mts`: read-only recipe above (`query()` SDK form).
