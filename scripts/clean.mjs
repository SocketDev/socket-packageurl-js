/**
 * @fileoverview Unified clean runner with flag-based configuration.
 * Removes build artifacts, caches, and other generated files.
 */

import { parseArgs } from 'node:util'

import { deleteAsync } from 'del'
import fastGlob from 'fast-glob'

import {
  getRootPath,
  isQuiet,
  log,
  printFooter,
  printHeader,
  printHelpHeader
} from './utils/common.mjs'

const rootPath = getRootPath(import.meta.url)

/**
 * Clean specific directories.
 */
async function cleanDirectories(tasks, options = {}) {
  const { quiet = false } = options

  for (const task of tasks) {
    const { name, pattern, patterns } = task
    const patternsToDelete = patterns || [pattern]

    if (!quiet) {
      log.progress(`Cleaning ${name}`)
    }

    try {
      // Find all files/dirs matching the patterns
      // eslint-disable-next-line no-await-in-loop
      const files = await fastGlob(patternsToDelete, {
        cwd: rootPath,
        absolute: true,
        dot: true,
        onlyFiles: false,
        markDirectories: true
      })

      // Delete each file/directory
      // eslint-disable-next-line no-await-in-loop
      await deleteAsync(files)

      if (!quiet) {
        if (files.length > 0) {
          log.done(`Cleaned ${name} (${files.length} items)`)
        } else {
          log.done(`Cleaned ${name} (already clean)`)
        }
      }
    } catch (error) {
      if (!quiet) {
        log.failed(`Failed to clean ${name}`)
        console.error(error.message)
      }
      return 1
    }
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
        all: {
          type: 'boolean',
          default: false,
        },
        cache: {
          type: 'boolean',
          default: false,
        },
        coverage: {
          type: 'boolean',
          default: false,
        },
        dist: {
          type: 'boolean',
          default: false,
        },
        types: {
          type: 'boolean',
          default: false,
        },
        modules: {
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
      printHelpHeader('Clean Runner')
      console.log('\nUsage: pnpm clean [options]')
      console.log('\nOptions:')
      console.log('  --help              Show this help message')
      console.log('  --all               Clean everything (default if no flags)')
      console.log('  --cache             Clean cache directories')
      console.log('  --coverage          Clean coverage reports')
      console.log('  --dist              Clean build output')
      console.log('  --types             Clean TypeScript declarations only')
      console.log('  --modules           Clean node_modules')
      console.log('  --quiet, --silent   Suppress progress messages')
      console.log('\nExamples:')
      console.log('  pnpm clean                  # Clean everything except node_modules')
      console.log('  pnpm clean --dist           # Clean build output only')
      console.log('  pnpm clean --cache --coverage  # Clean cache and coverage')
      console.log('  pnpm clean --all --modules  # Clean everything including node_modules')
      process.exitCode = 0
      return
    }

    const quiet = isQuiet(values)

    // Determine what to clean
    const cleanAll = values.all ||
      (!values.cache && !values.coverage && !values.dist && !values.types && !values.modules)

    const tasks = []

    // Build task list
    if (cleanAll || values.cache) {
      tasks.push({ name: 'cache', pattern: '**/.cache' })
    }

    if (cleanAll || values.coverage) {
      tasks.push({ name: 'coverage', pattern: 'coverage' })
    }

    if (cleanAll || values.dist) {
      tasks.push({ name: 'dist', patterns: ['dist', '*.tsbuildinfo', '.tsbuildinfo'] })
    } else if (values.types) {
      tasks.push({ name: 'dist/types', patterns: ['dist/types'] })
    }

    if (values.modules) {
      tasks.push({ name: 'node_modules', pattern: '**/node_modules' })
    }

    // Check if there's anything to clean
    if (tasks.length === 0) {
      if (!quiet) {
        log.info('Nothing to clean')
      }
      process.exitCode = 0
      return
    }

    if (!quiet) {
      printHeader('Clean Runner')
      log.step('Cleaning project directories')
    }

    // Clean directories
    const exitCode = await cleanDirectories(tasks, { quiet })

    if (exitCode !== 0) {
      if (!quiet) {
        log.error('Clean failed')
      }
      process.exitCode = exitCode
    } else {
      if (!quiet) {
        printFooter('Clean completed successfully!')
      }
    }
  } catch (error) {
    log.error(`Clean runner failed: ${error.message}`)
    process.exitCode = 1
  }
}

main().catch(console.error)