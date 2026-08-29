# Mode: install (new repo)

For Socket repos that don't yet have the gate:

1. Copy the gate file:
   ```bash
   cp .claude/skills/guarding-paths/templates/check-paths.mts.tmpl scripts/fleet/check/paths-are-canonical.mts
   ```
2. No allowlist file to create - exemptions live in the `pathsAllowlist` array of `.config/socket-wheelhouse.json` (absent key = no exemptions, which is the default).
3. Add `"check:paths": "node scripts/fleet/check/paths-are-canonical.mts"` to `package.json`.
4. Wire `runPathHygieneCheck()` into `scripts/check.mts` (after the existing checks).
5. Append the rule snippet from [`_shared/path-guard-rule.md`](../../_shared/path-guard-rule.md) to the repo's `CLAUDE.md` if a `1 path, 1 reference` section is missing.
6. Add the hook entry to `.claude/settings.json` `PreToolUse` matcher `Edit|Write`:
   ```json
   {
     "type": "command",
     "command": "node .claude/hooks/fleet/path-guard/index.mts"
   }
   ```
7. Run the gate against the repo. Triage findings as you would in audit-and-fix mode.
