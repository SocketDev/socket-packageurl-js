# What it does NOT do

- **Touch the `dependabot.yml` file.** That file MUST exist (GitHub
  refuses to fully disable Dependabot without it) and the fleet
  convention is to ship it pre-configured with
  `open-pull-requests-limit: 0`. The skill leaves the file alone;
  only the `automated-security-fixes` toggle is acted on.
- **Touch the org-level required-workflows repo.** Don't edit org-level required workflows from this skill. The org config is the source of truth for what runs cross-repo, and silent edits are unsafe.
- **Keep legitimate per-repo workflows.** socket-btm's per-binary build dispatchers (`curl.yml`, `lief.yml`, etc.), ultrathink's `build-*.yml`, socket-packageurl-js's `pages.yml` /`valtown.yml`, socket-registry's `_local-not-for-reuse-*.yml` dogfood copies all stay. The skill only matches the four canonical orphan names.
