/**
 * @file Process-isolated tests under test/isolated. The main suite excludes
 *   this directory; this suite preserves its fork boundary and coverage.
 */
import { defineConfig } from 'vitest/config'

import { COVERAGE_SCRATCH_VITEST_DIR } from '../../scripts/fleet/paths.mts'

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
    testTimeout: 10_000,
    hookTimeout: 10_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov', 'clover'],
      reportsDirectory: COVERAGE_SCRATCH_VITEST_DIR,
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
