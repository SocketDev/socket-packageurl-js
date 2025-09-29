import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['test/**/*.test.mts'],
    reporters: ['default'],
    // Improve memory usage by running tests sequentially in CI.
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
        maxForks: 1,
        // Isolate tests to prevent memory leaks between test files.
        isolate: true,
      },
      threads: {
        singleThread: true,
        // Limit thread concurrency to prevent RegExp compiler exhaustion.
        maxThreads: 1,
      },
    },
    testTimeout: 60_000,
    hookTimeout: 60_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
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
      ],
      all: true,
      thresholds: {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100,
      },
      // Coverage should report on src files.
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      // Enable source maps for proper coverage mapping.
      sourcemap: true,
    },
  },
  resolve: {
    alias: [
      // Map dist imports to src for proper coverage tracking.
      {
        find: /^\.\.\/dist\/(.*)\.js$/,
        replacement: path.resolve(__dirname, 'src/$1.ts'),
      },
      {
        find: /^\.\/dist\/(.*)\.js$/,
        replacement: path.resolve(__dirname, 'src/$1.ts'),
      },
    ],
  },
})
