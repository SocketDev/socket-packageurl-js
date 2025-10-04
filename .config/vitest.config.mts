import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isCoverage = process.argv.includes('--coverage')

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
        branches: 99.8,
        functions: 100,
        lines: 99.8,
        statements: 99.8,
      },
      // Coverage should report on src files.
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
    },
  },
  resolve: {
    // Map dist imports to src when running coverage, use dist otherwise.
    alias: isCoverage
      ? [
          {
            // Match: ../dist/some-module.js
            find: /^\.\.\/dist\/(.*)\.js$/,
            // Replace: src/some-module.ts
            replacement: path.resolve(__dirname, '../src/$1.ts'),
          },
          {
            // Match: ./dist/some-module.js
            find: /^\.\/dist\/(.*)\.js$/,
            // Replace: src/some-module.ts
            replacement: path.resolve(__dirname, '../src/$1.ts'),
          },
        ]
      : [],
  },
})
