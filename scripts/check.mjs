/**
 * @fileoverview Unified check runner with flag-based configuration.
 * Runs code quality checks: ESLint and TypeScript type checking.
 */

import { parseArgs } from 'node:util'

import { logger } from '@socketsecurity/registry/lib/logger'
import { printFooter, printHeader } from '@socketsecurity/registry/lib/stdio/header'

import { runCommandQuiet } from './utils/run-command.mjs'

/**
 * Run ESLint check.
 */
async function runEslintCheck(options = {}) {
  const { quiet = false } = options

  if (!quiet) {
    logger.progress('Checking ESLint')
  }

  const result = await runCommandQuiet('eslint', [
    '--config',
    '.config/eslint.config.mjs',
    '--report-unused-disable-directives',
    '.',
  ])

  if (result.exitCode !== 0) {
    if (!quiet) {
      logger.error('ESLint check failed')
    }
    if (result.stdout) {
      console.log(result.stdout)
    }
    if (result.stderr) {
      console.error(result.stderr)
    }
    return result.exitCode
  }

  if (!quiet) {
    logger.done('ESLint check passed')
  }

  return 0
}

/**
 * Run TypeScript type check.
 */
async function runTypeCheck(options = {}) {
  const { quiet = false } = options

  if (!quiet) {
    logger.progress('Checking TypeScript')
  }

  const result = await runCommandQuiet('tsgo', [
    '--noEmit',
    '-p',
    '.config/tsconfig.check.json'
  ])

  if (result.exitCode !== 0) {
    if (!quiet) {
      logger.error('TypeScript check failed')
    }
    if (result.stdout) {
      console.log(result.stdout)
    }
    if (result.stderr) {
      console.error(result.stderr)
    }
    return result.exitCode
  }

  if (!quiet) {
    logger.done('TypeScript check passed')
  }

  return 0
}

async function main() {
  try {
    // Parse arguments
    const { values } = parseArgs({
      options: {
        help: {
          type: 'boolean',
          default: false,
        },
        lint: {
          type: 'boolean',
          default: false,
        },
        types: {
          type: 'boolean',
          default: false,
        },
        quiet: {
          type: 'boolean',
          default: false,
        },
        silent: {
          type: 'boolean',
          default: false,
        },
      },
      allowPositionals: false,
      strict: false,
    })

    // Show help if requested
    if (values.help) {
      console.log('Check Runner')
      console.log('\nUsage: pnpm check [options]')
      console.log('\nOptions:')
      console.log('  --help         Show this help message')
      console.log('  --lint         Run ESLint check only')
      console.log('  --types        Run TypeScript check only')
      console.log('  --quiet, --silent  Suppress progress messages')
      console.log('\nExamples:')
      console.log('  pnpm check             # Run all checks')
      console.log('  pnpm check --lint      # Run ESLint only')
      console.log('  pnpm check --types     # Run TypeScript only')
      process.exitCode = 0
      return
    }

    const quiet = values.quiet || values.silent
    const runAll = !values.lint && !values.types

    if (!quiet) {
      printHeader('Running Checks')
      logger.step('Running code quality checks')
    }

    let exitCode = 0

    // Run ESLint check if requested or running all
    if (runAll || values.lint) {
      exitCode = await runEslintCheck({ quiet })
      if (exitCode !== 0) {
        if (!quiet) {
          logger.error('Checks failed')
        }
        process.exitCode = exitCode
        return
      }
    }

    // Run TypeScript check if requested or running all
    if (runAll || values.types) {
      exitCode = await runTypeCheck({ quiet })
      if (exitCode !== 0) {
        if (!quiet) {
          logger.error('Checks failed')
        }
        process.exitCode = exitCode
        return
      }
    }

    if (!quiet) {
      logger.success('All checks passed')
      printFooter()
    }
  } catch (error) {
    logger.error(`Check runner failed: ${error.message}`)
    process.exitCode = 1
  }
}

main().catch(console.error)
