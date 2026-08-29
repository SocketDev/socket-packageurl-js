# Invocation patterns

### Multi-lane (recommended for cross-lane parity checks)

```bash
cd packages/acorn

# All 4 lanes, full suite
node test/test262-compare.mts

# Subset of lanes
node test/test262-compare.mts --lane rust,go

# All lanes, filtered to a single category
node test/test262-compare.mts --include 'language/expressions/await'

# Single test path, all lanes
node test/test262-compare.mts test/language/statements/class/private-method.js
```

Lanes: `rust`, `go`, `cpp`, `typescript`. Flags forward to each per-lane runner.

### Single-lane

```bash
# Per-lane direct invocation
cd packages/acorn/lang/rust && node scripts/test262.mts
cd packages/acorn/lang/go && node scripts/test262.mts
cd packages/acorn/lang/cpp && node scripts/test262.mts
cd packages/acorn/lang/typescript && node scripts/test262.mts

# socket-btm temporal-infra
cd socket-btm/packages/temporal-infra && node test/scripts/test262-temporal-runner.mts
```

### Single-case debug

Pass the test path positionally:

```bash
# Single lane
node scripts/test262.mts test/language/expressions/await/await-in-nested-function.js

# All lanes
node test/test262-compare.mts test/language/expressions/await/await-in-nested-function.js
```

### Targeted filtering

```bash
node scripts/test262.mts --include 'export'          # regex on path
node scripts/test262.mts --exclude 'surrogate'       # regex on path
node scripts/test262.mts --category module           # named feature group
node scripts/test262.mts --include 'class' --exclude 'async'
```

### Vitest-integrated mode

Each repo also wires a vitest test that wraps the runner. Useful for CI integration and selective re-runs:

```bash
pnpm exec vitest run test/unit/test262.test.mts             # ultrathink acorn
pnpm exec vitest run test/unit/test262-temporal.test.mts    # socket-btm temporal
```
