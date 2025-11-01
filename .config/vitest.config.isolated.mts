/**
 * @fileoverview Vitest configuration for tests requiring full process isolation.
 *
 * USE THIS CONFIG FOR:
 * - Tests that modify global objects (global.URL, global.process, etc.)
 * - Tests using vi.doMock() for dynamic module mocking
 * - Tests that would cause race conditions in concurrent execution
 * - Tests requiring complete process-level isolation
 *
 * NAMING CONVENTION:
 * Files using this config MUST use: *.isolated.test.mts suffix
 *
 * PERFORMANCE TRADEOFF:
 * - pool: 'forks' - Full process isolation (slower than threads)
 * - Each test file runs in its own forked process
 * - No shared state between test files
 * - Automatically detected and run by scripts/test.mjs
 *
 * EXAMPLES:
 * - test/purl-global-mocking.isolated.test.mts - Mocks global.URL constructor
 *
 * See main config (.config/vitest.config.mts) for standard concurrent tests.
 */
import { defineConfig } from 'vitest/config'

// Check if coverage is enabled via CLI flags or environment.
const isCoverageEnabled =
  process.env.COVERAGE === 'true' ||
  process.env.npm_lifecycle_event?.includes('coverage') ||
  process.argv.some(arg => arg.includes('coverage'))

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['test/**/*.test.{js,ts,mjs,mts,cjs}'],
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
    // Share coverage settings with main config
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov', 'clover'],
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
        'src/index.ts',
        'perf/**',
        // Explicit root-level exclusions
        '/scripts/**',
        '/test/**',
      ],
      include: ['src/**/*.ts'],
      all: true,
      clean: true,
      skipFull: false,
      ignoreClassMethods: ['constructor'],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
})
