# Continuous Integration (CI) Documentation

This document describes the comprehensive CI testing solution for socket-packageurl-js, based on the patterns established in socket-registry.

## Overview

The CI pipeline is designed for reliability, speed, and comprehensive coverage. It leverages reusable workflows from `SocketDev/socket-registry` to ensure consistency across all Socket projects.

## Workflows

### 🚀 Main CI Pipeline (`ci.yml`)

**Purpose**: Orchestrates all quality checks in parallel for fast feedback.

**Triggers**:
- Push to `main` branch
- Pull requests to `main`
- Manual workflow dispatch

**Jobs**:
1. **Lint Check** - Runs ESLint, Biome, and Oxlint
2. **Type Check** - Validates TypeScript types with tsgo
3. **Test Matrix** - Tests across Node 20, 22, 24 on Ubuntu and Windows
4. **Coverage Report** - Generates and uploads coverage artifacts
5. **CI Summary** - Validates all jobs passed

**Configuration**:
```yaml
lint:
  node-version: '22'
  timeout-minutes: 10

type-check:
  node-version: '22'
  timeout-minutes: 10

test:
  node-versions: '[20, 22, 24]'
  os-versions: '["ubuntu-latest", "windows-latest"]'
  timeout-minutes: 15
  fail-fast: false
  max-parallel: 4
```

### 🧪 Test Workflow (`test.yml`)

**Purpose**: Comprehensive cross-platform and cross-version testing.

**Features**:
- Tests on Node.js 20, 22, and 24
- Tests on Ubuntu and Windows
- Non-blocking (fail-fast: false) to see all failures
- Parallel execution (max 4 jobs)
- 15-minute timeout per job

**Usage**:
```bash
# Local testing
pnpm run test-ci

# CI environment
pnpm run build && pnpm run test-ci
```

### 🧹 Lint Workflow (`lint.yml`)

**Purpose**: Code quality and style enforcement.

**Checks**:
- ESLint with TypeScript support
- Oxlint for fast Rust-based linting
- Biome for formatting

**Configuration**:
- Runs on Node.js 22 (latest LTS)
- Ubuntu runner (fast and cost-effective)
- 10-minute timeout

**Usage**:
```bash
# CI lint check
pnpm run check-ci

# Local development
pnpm run check:lint
pnpm run check:lint:fix
```

### 🔍 Type Check Workflow (`types.yml`)

**Purpose**: TypeScript type safety validation.

**Features**:
- Uses tsgo (native TypeScript compiler)
- Runs type-coverage checks
- Builds project first to ensure types are generated

**Configuration**:
- Node.js 22 for consistency
- 10-minute timeout
- Requires build step

**Usage**:
```bash
# CI type check
pnpm run build && pnpm run check:tsc

# Local development
pnpm run check:tsc
```

## Reusable Workflow Reference

All workflows use reusable workflows from `SocketDev/socket-registry/.github/workflows/`:

### Test Workflow Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `node-versions` | `[20, 22, 24]` | Node.js versions to test |
| `os-versions` | `["ubuntu-latest", "windows-latest"]` | Operating systems |
| `setup-script` | `''` | Script to run before tests |
| `test-script` | `'pnpm run test-ci'` | Test command |
| `timeout-minutes` | `10` | Job timeout |
| `fail-fast` | `true` | Cancel all jobs if one fails |
| `max-parallel` | `4` | Maximum concurrent jobs |

### Lint Workflow Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `lint-script` | `'pnpm run check-ci'` | Lint command |
| `node-version` | `'22'` | Node.js version |
| `os` | `'ubuntu-latest'` | Operating system |
| `timeout-minutes` | `10` | Job timeout |

### Type Check Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `type-script` | `'pnpm run check:tsc'` | Type check command |
| `setup-script` | `''` | Setup before type checking |
| `node-version` | `'22'` | Node.js version |
| `timeout-minutes` | `10` | Job timeout |

## Best Practices

### 1. Concurrency Control

All workflows use concurrency groups to cancel outdated runs:
```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.head_ref || github.run_id }}
  cancel-in-progress: true
```

This saves CI minutes by canceling superseded runs when new commits are pushed.

### 2. Fail-Fast Strategy

The test matrix uses `fail-fast: false` to:
- Show all test failures across platforms
- Identify platform-specific issues
- Provide complete failure information

### 3. Timeout Configuration

Timeouts are set conservatively:
- **Lint**: 10 minutes (fast)
- **Type Check**: 10 minutes (requires build)
- **Tests**: 15 minutes (includes build + cross-platform)
- **Coverage**: 15 minutes (most intensive)

### 4. Node Version Support

Supports Node.js LTS and current versions:
- **Node 20**: Active LTS (until April 2026)
- **Node 22**: Active LTS (until April 2027)
- **Node 24**: Current (becomes LTS October 2025)

### 5. Cross-Platform Testing

Tests on both:
- **Ubuntu**: Fast, cost-effective, primary development platform
- **Windows**: Ensures compatibility with Windows-specific issues

macOS testing can be added if needed, but is typically unnecessary for Node.js libraries.

## Local Development

### Running All Checks Locally

```bash
# Complete test suite (same as CI)
pnpm test

# Individual checks
pnpm run check:lint      # Linting only
pnpm run check:tsc       # Type checking only
pnpm run test:unit       # Unit tests only

# With coverage
pnpm run coverage
pnpm run coverage:percent
```

### Pre-commit Hooks

The project uses Husky and lint-staged:
```bash
# Runs automatically on git commit
git commit -m "message"

# Manual run
pnpm run lint-staged
```

### Fixing Issues

```bash
# Auto-fix lint issues
pnpm run fix

# Fix specific issues
pnpm run check:lint:fix
pnpm run lint:fix
```

## Troubleshooting

### Test Failures

1. **Platform-specific failures**: Check the test matrix to see which OS/Node version failed
2. **Timeout failures**: Increase timeout in workflow configuration
3. **Flaky tests**: Review test isolation and async handling

### Type Check Failures

1. **Missing types**: Run `pnpm run build` to generate type declarations
2. **Type coverage**: Check `pnpm run coverage:type:verbose` for details
3. **tsgo issues**: Ensure `@typescript/native-preview` is up to date

### Lint Failures

1. **Oxlint errors**: Fast but may need exceptions in `.oxlintrc.json`
2. **ESLint errors**: Check `.eslintrc` configuration
3. **Biome errors**: Review `biome.json` settings

### CI-Only Failures

If tests pass locally but fail in CI:
1. Check Node.js version matches (`node --version`)
2. Verify environment variables (`.env.test`)
3. Review OS-specific path handling
4. Check for race conditions in tests

## Performance Optimization

### Caching

The reusable workflows automatically cache:
- pnpm dependencies
- Build outputs
- Node modules

### Parallel Execution

- Lint, type check, and tests run in parallel
- Test matrix runs 4 jobs concurrently
- Coverage report runs independently

### Artifact Management

Coverage reports are uploaded with 7-day retention:
```yaml
retention-days: 7
```

Adjust if longer retention is needed.

## Future Enhancements

Potential improvements:
1. **macOS testing**: Add if platform-specific issues arise
2. **Nightly Node builds**: Test against cutting-edge Node.js
3. **Coverage thresholds**: Enforce minimum coverage requirements
4. **Dependency security**: Add automated security scanning
5. **Performance benchmarks**: Track performance regressions

## References

- [socket-registry workflows](https://github.com/SocketDev/socket-registry/tree/main/.github/workflows)
- [GitHub Actions reusable workflows](https://docs.github.com/en/actions/using-workflows/reusing-workflows)
- [Node.js release schedule](https://github.com/nodejs/release#release-schedule)
