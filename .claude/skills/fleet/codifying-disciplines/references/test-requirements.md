# Tests are mandatory - a codification without a test is not done

Every codification this skill produces ships with **thorough tests** (plural - multiple cases that exercise every branch), in the same change. One assertion proves nothing; a token "it blocks the bad thing" test that never checks the good thing passes through, the bypass, or the edge cases is NOT thorough and does not count. Cover, at minimum:

- **Both arms.** Every enforcer has a fires-case AND a does-not-fire case. A guard: a blocked input (exit 2) AND a clean input that passes (exit 0). A reminder: a flagged state AND a quiet state. A lint rule: `invalid` cases AND `valid` cases.
- **Every branch.** One case per distinct code path: each banned pattern/shape the rule matches, each allowlist exemption, each early-return. If the enforcer has five regexes, the test has ≥five firing cases plus the non-matches they must NOT catch.
- **The escape hatch.** The bypass phrase / disable path, asserted to actually let the action through.
- **Pass-through / non-applicability.** A wrong-tool, wrong-file-type, or out-of-scope input that the enforcer must ignore (a guard must not fire on unrelated Bash; a lint rule must not touch unrelated files).
- **Edge + adversarial inputs.** Empty/malformed payload (fail-open, not crash), var-indirection / quoting that could evade an AST-vs-regex check, the look-alike that should NOT match (`my-semver` vs `semver`), boundary values.

Per surface:

- **Lint rule** → `RuleTester` test at `.config/fleet/oxlint-plugin/fleet/<name>/test/<name>.test.mts` with a full `valid[]` + `invalid[]` matrix (every shape + every exemption), and an `output` assertion on each autofix case (assert the FIXED TEXT, not just `messageId` - the fleet has been bitten by autofix-corruption bugs that passed because tests only checked `messageId`). Confirm the plugin still loads (`oxlint-plugin-loads.mts`); a broken rule import silently disables ALL `socket/` rules.
- **Hook** → `test/index.test.mts` that spawns the hook as a subprocess across the full case set above: each blocked shape, each passing shape, the bypass phrase, a pass-through tool, and a malformed-payload fail-open. Assert exit code + message per case.
- **Check script** → drifted fixture → non-zero exit; clean fixture → zero; plus a fixture per distinct drift kind it detects.
- **Skill / command** → structural checks (`model:` tier on a mutating skill, citation resolves) + a dry-run of the happy path AND a degraded path (missing input, non-interactive).

The proposal is incomplete until the tests exist, cover every branch, and pass. Run them before committing.
