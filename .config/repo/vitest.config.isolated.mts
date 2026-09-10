/**
 * @file Process-isolated tests under test/isolated. The main suite excludes
 *   this directory; this suite preserves its fork boundary and coverage.
 */
import process from 'node:process'

import { defineConfig } from 'vitest/config'

// Check if coverage is enabled via CLI flags or environment.
const isCoverageEnabled =
  process.env.COVERAGE === 'true' ||
  process.env.npm_lifecycle_event?.includes('coverage') ||
  process.argv.some(arg => arg.includes('coverage'))

// vitest loads the config from this module's default export.
// oxlint-disable-next-line socket/no-default-export -- vitest config export
export default defineConfig({
  test: {
    deps: {
      interopDefault: false,
    },
    globals: false,
    environment: 'node',
    include: ['test/isolated/**/*.test.{js,ts,mjs,mts,cjs}'],
    reporters: ['default'],
    setupFiles: ['./test/utils/setup.mts'],
    // Use forks for full isolation
    pool: 'forks',
    poolOptions: {
      forks: {
        // Use single fork for coverage, parallel otherwise
        singleFork: isCoverageEnabled,
        maxForks: isCoverageEnabled ? 1 : 8,
        minForks: isCoverageEnabled ? 1 : 2,
      },
    },
    testTimeout: 10_000,
    hookTimeout: 10_000,
    // Share coverage settings with main config, but write to a SEPARATE
    // reports directory: the composite runner (scripts/fleet/cover.mts)
    // merges coverage/coverage-final.json (main tier) with
    // coverage-isolated/coverage-final.json (this tier). Without the
    // override, this tier's `clean: true` wipes the main tier's report
    // before the merge reads it. Per-tier thresholds stay OFF — this tier
    // alone covers almost nothing; the merged gate in .config/repo/cover.json
    // owns the thresholds.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov', 'clover'],
      reportsDirectory: './coverage-isolated',
      exclude: [
        '**/*.config.*',
        '**/node_modules/**',
        '**/[.]**',
        '**/*.d.ts',
        '**/virtual:*',
        'coverage/**',
        'data/**',
        'dist/**',
        'scripts/**',
        'test/**',
        'perf/**',
        // Explicit root-level exclusions
        '/scripts/**',
        '/test/**',
      ],
      include: ['src/**/*.mts'],
      all: true,
      clean: true,
      skipFull: false,
      ignoreClassMethods: ['constructor'],
    },
  },
})
