/**
 * @fileoverview Main Vitest configuration for concurrent test execution.
 *
 * USE THIS CONFIG FOR:
 * - Standard test files (*.test.mts)
 * - Tests that don't modify global objects
 * - Tests that don't require vi.doMock() or dynamic module mocking
 * - All tests that can run concurrently without interference
 *
 * PERFORMANCE OPTIMIZATIONS:
 * - pool: 'threads' - Fast worker threads vs slower process forks
 * - isolate: false - Shared worker context for better nock/vi.mock() compatibility
 * - concurrent: true - Tests run in parallel within suites
 * - Adaptive thread count - More threads in dev, single thread for coverage
 *
 * FOR ISOLATED TESTS:
 * Use .config/vitest.config.isolated.mts for tests requiring:
 * - Global object mocking (global.URL, global.process, etc.)
 * - vi.doMock() with dynamic module replacement
 * - Full process isolation between tests
 * - File naming: *.isolated.test.mts suffix
 */
import { defineConfig } from 'vitest/config'

// Check if coverage is enabled via CLI flags or environment.
const isCoverageEnabled =
  process.env.COVERAGE === 'true' ||
  process.env.npm_lifecycle_event?.includes('coverage') ||
  process.argv.some(arg => arg.includes('coverage'))

// Set environment variable so tests can detect coverage mode
if (isCoverageEnabled) {
  process.env.COVERAGE = 'true'
}

export default defineConfig({
  cacheDir: './.cache/vitest',
  test: {
    globals: false,
    environment: 'node',
    include: ['test/**/*.test.mts'],
    reporters: ['default'],
    setupFiles: ['./test/utils/setup.mts'],
    // Use threads for better performance
    pool: 'threads',
    poolOptions: {
      forks: {
        // Configuration for tests that opt into fork isolation via { pool: 'forks' }
        // During coverage, use multiple forks for better isolation
        singleFork: false,
        maxForks: isCoverageEnabled ? 4 : 16,
        minForks: isCoverageEnabled ? 1 : 2,
        isolate: true,
      },
      threads: {
        // Use single thread to prevent worker termination errors.
        // Multiple threads with isolate: false can cause race conditions in tinypool cleanup.
        singleThread: true,
        maxThreads: 1,
        minThreads: 1,
        // IMPORTANT: isolate: false for performance and test compatibility
        //
        // Tradeoff Analysis:
        // - isolate: true  = Full isolation, slower, breaks nock/module mocking
        // - isolate: false = Shared worker context, faster, mocking works
        //
        // We choose isolate: false because:
        // 1. Significant performance improvement (faster test runs)
        // 2. Nock HTTP mocking works correctly across all test files
        // 3. Vi.mock() module mocking functions properly
        // 4. Test state pollution is prevented through proper beforeEach/afterEach
        // 5. Our tests are designed to clean up after themselves
        //
        // Tests requiring true isolation should use pool: 'forks' or be marked
        // with { pool: 'forks' } in the test file itself.
        isolate: false,
        // Use worker threads for better performance
        useAtomics: true,
      },
    },
    // Reduce timeouts for faster failures
    testTimeout: 10_000,
    hookTimeout: 10_000,
    // Bail early on first failure in CI
    bail: process.env.CI ? 1 : 0,
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
      all: true,
      clean: true,
      skipFull: false,
      ignoreClassMethods: ['constructor'],
      thresholds: {
        branches: 99,
        functions: 99,
        lines: 99,
        statements: 99,
      },
      // Coverage should report on src files.
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
    },
  },
})
