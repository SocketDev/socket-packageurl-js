/**
 * @file Maps changed source files to test files for affected test running. Uses
 *   git utilities from socket-registry to detect changes.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'

import {
  getChangedFilesSync,
  getStagedFilesSync,
} from '@socketsecurity/lib-stable/git'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { REPO_ROOT } from '../paths.mts'

type TestsToRunOptions = {
  all?: boolean | undefined
  staged?: boolean | undefined
}

type TestsToRunResult = {
  mode?: string | undefined
  reason?: string | undefined
  tests: string[] | 'all' | undefined
}

const rootPath: string = REPO_ROOT

/**
 * Core files that require running all tests when changed.
 */
const CORE_FILES = [
  'src/helpers.ts',
  'src/strings.ts',
  'src/constants.ts',
  'src/lang.ts',
  'src/error.ts',
  'src/validate.ts',
  'src/normalize.ts',
  'src/encode.ts',
  'src/decode.ts',
  'src/objects.ts',
]

/**
 * Get affected test files to run based on changed files.
 *
 * @param {Object} options
 * @param {boolean} options.staged - Use staged files instead of all changes.
 * @param {boolean} options.all - Run all tests.
 *
 * @returns {{ tests: string[] | 'all' | null; reason?: string; mode?: string }}
 *   Object with test patterns, reason, and mode.
 */
export function getTestsToRun(
  options: TestsToRunOptions = {},
): TestsToRunResult {
  const { all = false, staged = false } = options

  // All mode runs all tests
  if (all || process.env.FORCE_TEST === '1') {
    return { tests: 'all', reason: 'explicit --all flag', mode: 'all' }
  }

  // CI always runs all tests
  if (process.env.CI === 'true') {
    return { tests: 'all', reason: 'CI environment', mode: 'all' }
  }

  // Get changed files
  const changedFiles = staged ? getStagedFilesSync() : getChangedFilesSync()
  const mode = staged ? 'staged' : 'changed'

  if (changedFiles.length === 0) {
    // No changes, skip tests
    return { tests: undefined, mode }
  }

  const testFiles = new Set<string>()
  let runAllTests = false
  let runAllReason = ''

  for (let i = 0, { length } = changedFiles; i < length; i += 1) {
    const file = changedFiles[i]
    const normalized = normalizePath(file)

    // Test files always run themselves
    if (normalized.startsWith('test/') && normalized.includes('.test.')) {
      // Skip deleted files.
      if (existsSync(path.join(rootPath, file))) {
        testFiles.add(file)
      }
      continue
    }

    // Source files map to test files
    if (normalized.startsWith('src/')) {
      const tests = mapSourceToTests(normalized)
      if (tests.includes('all')) {
        runAllTests = true
        runAllReason = 'core file changes'
        break
      }
      for (let i = 0, { length } = tests; i < length; i += 1) {
        const test = tests[i]
        // Skip deleted files.
        if (existsSync(path.join(rootPath, test))) {
          testFiles.add(test)
        }
      }
      continue
    }

    // Config changes run all tests
    if (normalized.includes('vitest.config')) {
      runAllTests = true
      runAllReason = 'vitest config changed'
      break
    }

    if (normalized.includes('tsconfig')) {
      runAllTests = true
      runAllReason = 'TypeScript config changed'
      break
    }

    // Data changes run integration tests
    if (normalized.startsWith('data/')) {
      // Skip deleted files.
      if (existsSync(path.join(rootPath, 'test/integration.test.mts'))) {
        testFiles.add('test/integration.test.mts')
      }
      if (existsSync(path.join(rootPath, 'test/purl-types.test.mts'))) {
        testFiles.add('test/purl-types.test.mts')
      }
    }
  }

  if (runAllTests) {
    return { tests: 'all', reason: runAllReason, mode: 'all' }
  }

  if (testFiles.size === 0) {
    return { tests: undefined, mode }
  }

  return { tests: Array.from(testFiles), mode }
}

/**
 * Map source files to their corresponding test files.
 */
export function mapSourceToTests(filepath: string): string[] {
  const normalized: string = normalizePath(filepath)

  // Skip non-code files
  const ext: string = path.extname(normalized)
  const codeExtensions: string[] = [
    '.js',
    '.mjs',
    '.cjs',
    '.ts',
    '.cts',
    '.mts',
    '.json',
  ]
  if (!codeExtensions.includes(ext)) {
    return []
  }

  // Core utilities affect all tests
  if (CORE_FILES.some(f => normalized.includes(f))) {
    return ['all']
  }

  // Map specific files to their test files
  const basename: string = path.basename(normalized, path.extname(normalized))
  const testFile: string = `test/${basename}.test.mts`

  // Check if corresponding test exists
  if (existsSync(path.join(rootPath, testFile))) {
    return [testFile]
  }

  // Special mappings
  if (normalized.includes('src/package-url.ts')) {
    return ['test/package-url.test.mts', 'test/integration.test.mts']
  }
  if (normalized.includes('src/package-url-builder.ts')) {
    return ['test/package-url-builder.test.mts', 'test/integration.test.mts']
  }
  if (normalized.includes('src/url-converter.ts')) {
    return ['test/url-converter.test.mts']
  }
  if (normalized.includes('src/result.ts')) {
    return ['test/result.test.mts']
  }

  // If no specific mapping, run all tests to be safe
  return ['all']
}
