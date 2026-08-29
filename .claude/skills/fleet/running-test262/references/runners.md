# Canonical runners per repo

| Repo                                          | Runner                                     | Skip config                                                                                                            |
| --------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| ultrathink/packages/acorn (multi-lane driver) | `test/test262-compare.mts`                 | per-lane runner config (inherits unsupported-features)                                                                 |
| ultrathink/packages/acorn (per-lane)          | `lang/<lane>/scripts/test262.mts`          | `test262-config/test262.unsupported-features` (feature-name-keyed)                                                     |
| ultrathink/packages/test262-parser-runner     | `bin/test262-parser-runner.mts`            | passed via flags                                                                                                       |
| socket-btm/packages/temporal-infra            | `test/scripts/test262-temporal-runner.mts` | `test262-config/test262.allowlist` (Temporal-only path allowlist; reviewed manually for non-parser-fail justification) |
