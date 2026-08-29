# The high-value fleet targets

"A bug here = red CI everywhere" surfaces. Property/fuzz them first:

- **Version + pin math** - `compareSemver`, `extractPinVersion`, `derivePins`,
  `applyPins` (`sync-package-manager-pins.mts`), `majorBoundedRange`.
  Properties: total order; `derivePins` always yields a valid `>=x <y`;
  `applyPins` is idempotent.
- **Config / marker validation** - `readSocketWheelhouseConfig`,
  `validateBundleBlock`. Property: never throws on arbitrary input; accepts iff
  genuinely valid.
- **Cascade `check ↔ fix` idempotence** (Tier 3) - for arbitrary synthetic
  trees: `collectFindings(applyFixes(x))` is clean (a fix never leaves a
  fixable finding), `applyFixes∘applyFixes = applyFixes`, and a fixer never
  mutates a path outside its finding's scope.
- **Untrusted-input boundaries (Tier 2)** - sdxgen's manifest/lockfile parsers,
  ultrathink's `acorn` JS/TS parser (every lane), envrypt's `.env` parse
  pipeline + ECIES decrypt, decmpfs's compression reader, and abitious's hybrid
  `.node` reader. A **native module is the top priority** - a crafted input can
  overflow/UAF the C++/Rust, which a JS-level test never sees - so fuzz the
  native code directly with libFuzzer/cargo-fuzz + ASan/UBSan, not only through
  the JS boundary.
