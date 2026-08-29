# Common failure modes

- **Submodule missing.** The test262 suite is a git submodule. If the runner errors with "test262 suite not found", run `git submodule update --init --recursive`.
- **Feature classification drift.** The runner uses each test's metadata block (`/*--- features: [...] ---*/`) to decide whether to run or skip. If a new TC39 feature is added upstream, classify it in the `unsupported-features` config first; do not let the runner silently pass tests for features the parser doesn't implement.
- **"Allowlist drift": does NOT apply here.** The acorn lanes don't carry a per-test-path allowlist. If a test starts passing or failing, that's the parser's behavior; either the parser is correct and the test is correct (good), or one of them is wrong and that's a bug.
- **Cross-fleet drift.** ultrathink and socket-btm should pin the same `tc39/test262` SHA. If you're investigating a flaky test, double-check both `.gitmodules` files first.
