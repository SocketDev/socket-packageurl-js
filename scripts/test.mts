/**
 * @fileoverview Unified test runner that provides a smooth, single-script experience.
 * Combines check, build, and test steps with clean, consistent output.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import glob from 'fast-glob'
import type { Options as FastGlobOptions } from 'fast-glob'

import { parseArgs } from '@socketsecurity/lib/argv/parse'
import type { Logger } from '@socketsecurity/lib/logger'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { onExit } from '@socketsecurity/lib/signal-exit'
import type { SpawnOptions, SpawnResult } from '@socketsecurity/lib/spawn'
import { spawn } from '@socketsecurity/lib/spawn'
import type { Spinner } from '@socketsecurity/lib/spinner'
import { getDefaultSpinner } from '@socketsecurity/lib/spinner'
import { printHeader } from '@socketsecurity/lib/stdio/header'

import { getTestsToRun } from './utils/changed-test-mapper.mts'
import { errorMessage } from './utils/error-message.mts'

type RunningProcess = SpawnResult['process']

type CommandOptions = SpawnOptions

type CommandOutput = {
  code: number
  stderr: string
  stdout: string
}

type TestSelectionOptions = {
  all: boolean
  coverage: boolean
  force: boolean
  staged: boolean
  update: boolean
}

type TestScriptValues = {
  all: boolean
  cover: boolean
  coverage: boolean
  fast: boolean
  force: boolean
  help: boolean
  quick: boolean
  staged: boolean
  'skip-build': boolean
  update: boolean
}

type InteractiveRunnerModule = {
  runTests: (
    command: string,
    args: string[],
    options?: {
      cwd?: string
      env?: NodeJS.ProcessEnv
      verbose?: boolean
    },
  ) => Promise<number>
}

const logger: Logger = getDefaultLogger()
const spinner: Spinner = getDefaultSpinner()

const WIN32 = process.platform === 'win32'

// Suppress non-fatal worker termination unhandled rejections
process.on(
  'unhandledRejection',
  (reason: unknown, _promise: Promise<unknown>): void => {
    const msg = errorMessage(reason)
    // Filter out known non-fatal worker termination errors
    if (
      msg.includes('Terminating worker thread') ||
      msg.includes('ThreadTermination')
    ) {
      // Ignore these - they're cleanup messages from vitest worker threads
      return
    }
    // Re-throw other unhandled rejections
    throw reason
  },
)

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.resolve(__dirname, '..')
const nodeModulesBinPath = path.join(rootPath, 'node_modules', '.bin')

// Track running processes for cleanup
const runningProcesses: Set<RunningProcess> = new Set()

// Setup exit handler
const removeExitHandler = onExit(
  (_code: number | null, signal: string | null): void => {
    // Stop spinner first
    try {
      spinner.stop()
    } catch {}

    // Kill all running processes
    for (const child of runningProcesses) {
      try {
        child.kill('SIGTERM')
      } catch {}
    }

    if (signal) {
      console.log(`\nReceived ${signal}, cleaning up...`)
      // Let onExit handle the exit with proper code
      process.exitCode = 128 + (signal === 'SIGINT' ? 2 : 15)
    }
  },
)

async function runCommand(
  command: string,
  args: string[] = [],
  options: CommandOptions = {},
): Promise<number> {
  return new Promise<number>((resolve, reject): void => {
    const spawnPromise = spawn(command, args, {
      stdio: 'inherit',
      ...(process.platform === 'win32' && { shell: true }),
      ...options,
    })

    const child = spawnPromise.process

    runningProcesses.add(child)

    child.on('exit', (code: number | null): void => {
      runningProcesses.delete(child)
      resolve(code || 0)
    })

    child.on('error', (error: Error): void => {
      runningProcesses.delete(child)
      reject(error)
    })
  })
}

async function runCommandWithOutput(
  command: string,
  args: string[] = [],
  options: CommandOptions = {},
): Promise<CommandOutput> {
  return new Promise<CommandOutput>((resolve, reject): void => {
    let stdout = ''
    let stderr = ''

    const spawnPromise = spawn(command, args, {
      ...(process.platform === 'win32' && { shell: true }),
      ...options,
    })

    const child = spawnPromise.process

    runningProcesses.add(child)

    if (child.stdout) {
      child.stdout.on('data', (data: Buffer | string): void => {
        stdout += data.toString()
      })
    }

    if (child.stderr) {
      child.stderr.on('data', (data: Buffer | string): void => {
        stderr += data.toString()
      })
    }

    child.on('exit', (code: number | null): void => {
      runningProcesses.delete(child)
      resolve({ code: code || 0, stdout, stderr })
    })

    child.on('error', (error: Error): void => {
      runningProcesses.delete(child)
      reject(error)
    })
  })
}

async function runCheck(): Promise<number> {
  logger.step('Running checks')

  // Run fix (auto-format) quietly since it has its own output
  spinner.start('Formatting code...')
  let exitCode = await runCommand('pnpm', ['run', 'fix'], {
    stdio: 'pipe',
  })
  if (exitCode !== 0) {
    spinner.stop()
    logger.error('Formatting failed')
    // Re-run with output to show errors
    await runCommand('pnpm', ['run', 'fix'])
    return exitCode
  }
  spinner.stop()
  logger.success('Code formatted')

  // Run oxlint to check for remaining issues
  spinner.start('Running oxlint...')
  exitCode = await runCommand(
    'pnpm',
    [
      'exec',
      'oxlint',
      '--config',
      '.oxlintrc.json',
      '--tsconfig',
      '.config/tsconfig.check.json',
      '--import-plugin',
      '--node-plugin',
      '.',
    ],
    {
      stdio: 'pipe',
    },
  )
  if (exitCode !== 0) {
    spinner.stop()
    logger.error('oxlint failed')
    // Re-run with output to show errors
    await runCommand('pnpm', [
      'exec',
      'oxlint',
      '--config',
      '.oxlintrc.json',
      '--tsconfig',
      '.config/tsconfig.check.json',
      '--import-plugin',
      '--node-plugin',
      '.',
    ])
    return exitCode
  }
  spinner.stop()
  logger.success('oxlint passed')

  // Run TypeScript check
  spinner.start('Checking TypeScript...')
  exitCode = await runCommand(
    'tsgo',
    ['--noEmit', '-p', '.config/tsconfig.check.json'],
    {
      stdio: 'pipe',
    },
  )
  if (exitCode !== 0) {
    spinner.stop()
    logger.error('TypeScript check failed')
    // Re-run with output to show errors
    await runCommand('tsgo', ['--noEmit', '-p', '.config/tsconfig.check.json'])
    return exitCode
  }
  spinner.stop()
  logger.success('TypeScript check passed')

  return exitCode
}

async function runBuild(): Promise<number> {
  const distIndexPath = path.join(rootPath, 'dist', 'index.js')
  if (!existsSync(distIndexPath)) {
    logger.step('Building project')
    return runCommand('pnpm', ['run', 'build'])
  }
  return 0
}

async function runTests(
  options: TestSelectionOptions,
  positionals: string[] = [],
): Promise<number> {
  const { all, coverage, force, staged, update } = options
  const runAll = all || force

  // Get tests to run
  const testInfo = getTestsToRun({ staged, all: runAll })
  const { mode, reason, tests: testsToRun } = testInfo

  // No tests needed
  if (testsToRun === null) {
    logger.substep('No relevant changes detected, skipping tests')
    return 0
  }

  // Prepare vitest command
  const vitestCmd = WIN32 ? 'vitest.cmd' : 'vitest'
  const vitestPath = path.join(nodeModulesBinPath, vitestCmd)

  // --passWithNoTests: a scoped run where the changed files don't resolve
  // to any test file should succeed rather than error with "No test files
  // found". Keeps pre-commit hooks passing when an edit touches only
  // non-testable code.
  const vitestArgs = [
    '--config',
    '.config/vitest.config.mts',
    'run',
    '--passWithNoTests',
  ]

  // Add coverage if requested
  if (coverage) {
    vitestArgs.push('--coverage')
  }

  // Add update if requested
  if (update) {
    vitestArgs.push('--update')
  }

  // Exclude isolated tests from main test run
  if (!vitestArgs.includes('*.isolated.test.mts')) {
    vitestArgs.push('--exclude', '**/*.isolated.test.mts')
  }

  // Add test patterns if not running all
  if (testsToRun === 'all') {
    logger.step(`Running all tests (${reason})`)
  } else {
    const modeText = mode === 'staged' ? 'staged' : 'changed'
    logger.step(`Running tests for ${modeText} files:`)
    testsToRun.forEach((test: string): void => logger.substep(test))
    vitestArgs.push(...testsToRun)
  }

  // Add any additional positional arguments
  if (positionals.length > 0) {
    vitestArgs.push(...positionals)
  }

  const spawnOptions: SpawnOptions = {
    cwd: rootPath,
    env: {
      ...process.env,
      NODE_OPTIONS:
        `${process.env['NODE_OPTIONS'] || ''} --max-old-space-size=${process.env['CI'] ? 8192 : 4096} --max-semi-space-size=512 --unhandled-rejections=warn`.trim(),
      VITEST: '1',
    },
    stdio: 'inherit',
  }

  // Use interactive runner for interactive Ctrl+O experience when appropriate
  if (process.stdout.isTTY) {
    const { runTests: runInteractiveTests } =
      (await import('./utils/interactive-runner.mts')) as InteractiveRunnerModule
    return runInteractiveTests(vitestPath, vitestArgs, {
      env: spawnOptions.env,
      cwd: typeof spawnOptions.cwd === 'string' ? spawnOptions.cwd : rootPath,
      verbose: false,
    })
  }

  // Fallback to execution with output capture to handle worker termination errors
  const result = await runCommandWithOutput(vitestPath, vitestArgs, {
    ...spawnOptions,
    stdio: ['inherit', 'pipe', 'pipe'],
  })

  // Print output
  if (result.stdout) {
    process.stdout.write(result.stdout)
  }
  if (result.stderr) {
    process.stderr.write(result.stderr)
  }

  // Check if we have worker termination error but no test failures
  const hasWorkerTerminationError =
    (result.stdout + result.stderr).includes('Terminating worker thread') ||
    (result.stdout + result.stderr).includes('ThreadTermination')

  const output = result.stdout + result.stderr
  const hasTestFailures =
    output.includes('FAIL') ||
    (output.includes('Test Files') && output.match(/(\d+) failed/) !== null) ||
    (output.includes('Tests') && output.match(/Tests\s+\d+ failed/) !== null)

  // Override exit code if we only have worker termination errors
  if (result.code !== 0 && hasWorkerTerminationError && !hasTestFailures) {
    return 0
  }

  return result.code
}

async function runIsolatedTests(): Promise<number> {
  // Check if there are any isolated tests
  const isolatedTests = await glob('test/**/*.isolated.test.mts', {
    cwd: rootPath,
  } satisfies FastGlobOptions)

  if (isolatedTests.length === 0) {
    return 0
  }

  logger.step(`Running ${isolatedTests.length} isolated test file(s)`)
  isolatedTests.forEach((test: string): void => logger.substep(test))

  const vitestCmd = WIN32 ? 'vitest.cmd' : 'vitest'
  const vitestPath = path.join(nodeModulesBinPath, vitestCmd)

  const spawnOptions: SpawnOptions = {
    cwd: rootPath,
    env: {
      ...process.env,
      NODE_OPTIONS:
        `${process.env['NODE_OPTIONS'] || ''} --max-old-space-size=${process.env['CI'] ? 8192 : 4096} --max-semi-space-size=512 --unhandled-rejections=warn`.trim(),
      VITEST: '1',
    },
    stdio: 'inherit',
  }

  return runCommand(
    vitestPath,
    ['--config', '.config/vitest.config.isolated.mts', 'run', ...isolatedTests],
    spawnOptions,
  )
}

async function main(): Promise<void> {
  try {
    // Parse arguments
    const { positionals, values } = parseArgs<TestScriptValues>({
      options: {
        help: {
          type: 'boolean',
          default: false,
        },
        fast: {
          type: 'boolean',
          default: false,
        },
        quick: {
          type: 'boolean',
          default: false,
        },
        'skip-build': {
          type: 'boolean',
          default: false,
        },
        staged: {
          type: 'boolean',
          default: false,
        },
        all: {
          type: 'boolean',
          default: false,
        },
        force: {
          type: 'boolean',
          default: false,
        },
        cover: {
          type: 'boolean',
          default: false,
        },
        coverage: {
          type: 'boolean',
          default: false,
        },
        update: {
          type: 'boolean',
          default: false,
        },
      },
      allowPositionals: true,
      strict: false,
    })

    // Show help if requested
    if (values.help) {
      console.log('Test Runner')
      console.log('\nUsage: pnpm test [options] [-- vitest-args...]')
      console.log('\nOptions:')
      console.log('  --help              Show this help message')
      console.log(
        '  --fast, --quick     Skip lint/type checks for faster execution',
      )
      console.log('  --cover, --coverage Run tests with code coverage')
      console.log('  --update            Update test snapshots')
      console.log('  --all, --force      Run all tests regardless of changes')
      console.log('  --staged            Run tests affected by staged changes')
      console.log('  --skip-build        Skip the build step')
      console.log('\nExamples:')
      console.log(
        '  pnpm test                  # Run checks, build, and tests for changed files',
      )
      console.log('  pnpm test --all            # Run all tests')
      console.log(
        '  pnpm test --fast           # Skip checks for quick testing',
      )
      console.log('  pnpm test --cover          # Run with coverage report')
      console.log('  pnpm test --fast --cover   # Quick test with coverage')
      console.log('  pnpm test --update         # Update test snapshots')
      console.log('  pnpm test -- --reporter=dot # Pass args to vitest')
      process.exitCode = 0
      return
    }

    printHeader('Test Runner')

    // Handle aliases
    const skipChecks = values.fast || values.quick
    const withCoverage = values.cover || values.coverage

    let exitCode = 0

    // Run checks unless skipped
    if (!skipChecks) {
      exitCode = await runCheck()
      if (exitCode !== 0) {
        logger.error('Checks failed')
        process.exitCode = exitCode
        return
      }
      logger.success('All checks passed')
    }

    // Run build unless skipped
    if (!values['skip-build']) {
      exitCode = await runBuild()
      if (exitCode !== 0) {
        logger.error('Build failed')
        process.exitCode = exitCode
        return
      }
    }

    // Run main tests
    exitCode = await runTests(
      { ...values, coverage: withCoverage },
      positionals,
    )

    if (exitCode !== 0) {
      logger.error('Main tests failed')
      process.exitCode = exitCode
      return
    }

    // Run isolated tests
    exitCode = await runIsolatedTests()

    if (exitCode !== 0) {
      logger.error('Isolated tests failed')
      process.exitCode = exitCode
    } else {
      logger.success('All tests passed!')
    }
  } catch (e) {
    // Ensure spinner is stopped
    try {
      spinner.stop()
    } catch {}
    logger.error(`Test runner failed: ${errorMessage(e)}`)
    process.exitCode = 1
  } finally {
    // Ensure spinner is stopped
    try {
      spinner.stop()
    } catch {}
    removeExitHandler()
    // Let Node.js exit naturally with process.exitCode
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
