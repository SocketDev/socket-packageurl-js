# CI Testing Guide

## Overview

This project uses socket-registry's centralized CI testing infrastructure. The solution provides:

- **🚨 MANDATORY**: Use `SocketDev/socket-registry/.github/workflows/ci.yml@main` for consistent CI
- **Multi-platform testing**: Linux, Windows, and macOS support
- **Multi-version Node.js matrix**: Test across Node.js 20, 22, and 24
- **Flexible configuration**: Customizable test scripts, timeouts, and artifact uploads
- **Memory optimization**: Configured heap sizes for CI and local environments
- **Cross-platform compatibility**: Handles Windows and POSIX path differences

**For socket-registry-specific package testing tools**, see `socket-registry/docs/CI_TESTING_TOOLS.md` and `socket-registry/docs/PACKAGE_TESTING_GUIDE.md`. These tools (`validate:packages`, `validate:ci`) are specific to socket-registry's package override structure.

## Workflow Structure

### Centralized CI Workflow

**🚨 MANDATORY**: Use `SocketDev/socket-registry/.github/workflows/ci.yml@main` for consistent CI across all Socket projects.

**Key Features:**
- Matrix testing across Node.js versions and operating systems
- Parallel execution of lint, type-check, test, and coverage
- Configurable scripts for project-specific requirements
- Artifact upload support for coverage reports
- Debug mode for verbose logging
- Timeout protection for long-running tests

### Main Test Workflow

Located at `.github/workflows/test.yml`, this workflow calls socket-registry's reusable CI workflow:

```yaml
jobs:
  test:
    uses: SocketDev/socket-registry/.github/workflows/ci.yml@main
    with:
      node-versions: '[20, 22, 24]'
      os-versions: '["ubuntu-latest", "windows-latest"]'
      test-script: 'pnpm run test'
      lint-script: 'pnpm run check:lint'
      type-check-script: 'pnpm run check:tsc'
      timeout-minutes: 10
```

**Note**: For projects still using local reusable workflows (`.github/workflows/_reusable-test.yml`), migrate to socket-registry's centralized workflow.

## Configuration Options

### Input Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `node-versions` | Array of Node.js versions to test | `[20, 22, 24]` |
| `os-versions` | Array of operating systems | `["ubuntu-latest", "windows-latest"]` |
| `test-script` | Test command to execute | `pnpm run test` |
| `lint-script` | Lint command to execute | `pnpm run check:lint` |
| `type-check-script` | Type check command to execute | `pnpm run check:tsc` |
| `timeout-minutes` | Job timeout in minutes | `10` |
| `upload-artifacts` | Upload test artifacts | `false` |
| `fail-fast` | Cancel all jobs if one fails | `true` |
| `max-parallel` | Maximum parallel jobs | `4` |
| `continue-on-error` | Continue on job failure | `false` |

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `CI` | Detect CI environment |
| `NODE_OPTIONS` | Node.js runtime options |
| `DEBUG` | Enable debug logging |

## Best Practices

### 1. Use Centralized Workflow

Always use socket-registry's centralized CI workflow for consistency:
```yaml
uses: SocketDev/socket-registry/.github/workflows/ci.yml@main
```

### 2. Configure Timeouts

Set appropriate timeouts for your test suite:
```yaml
timeout-minutes: 10  # Adjust based on suite size
```

### 3. Platform-Specific Tests

Use matrix exclude for platform-specific issues if needed.

### 4. Debug Mode

Enable debug mode for troubleshooting:
```yaml
debug: '1'
```

## Local Testing

### Run Full Test Suite
```bash
pnpm test
```

### Run with Coverage
```bash
pnpm coverage
```

### Run Linting
```bash
pnpm check:lint
```

### Run Type Checking
```bash
pnpm check:tsc
```

### Run All Checks
```bash
pnpm check
```

## Troubleshooting

### Test Timeouts

1. Increase `timeout-minutes` in workflow
2. Review individual test timeouts
3. Check for slow operations

### Coverage Gaps

1. Run `pnpm coverage` locally
2. Review coverage reports
3. Add tests for uncovered code paths

## Integration with socket-registry

This project uses socket-registry's centralized CI infrastructure:
- **CI Workflow**: `SocketDev/socket-registry/.github/workflows/ci.yml@main`
- **Cross-platform compatibility**: Follows socket-registry guidelines
- **Memory optimization**: Aligned with socket-registry patterns

**Socket-registry-specific tools**: The `validate:packages` and `validate:ci` scripts in socket-registry are specific to its package override structure and not applicable to purl projects. See `socket-registry/docs/CI_TESTING_TOOLS.md` and `socket-registry/docs/PACKAGE_TESTING_GUIDE.md` for details.

For consistency across Socket projects, follow the patterns established in socket-registry/CLAUDE.md and documented here.
