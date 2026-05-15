/**
 * @fileoverview Unified clean runner with flag-based configuration.
 * Removes build artifacts, caches, and other generated files.
 */

import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { deleteAsync } from 'del'
import fastGlob from 'fast-glob'

import { isQuiet } from '@socketsecurity/lib-stable/argv/flags'
import type { FlagValues } from '@socketsecurity/lib-stable/argv/flags'
import { parseArgs } from '@socketsecurity/lib-stable/argv/parse'
import type { Logger } from '@socketsecurity/lib-stable/logger'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger'
import { createSectionHeader } from '@socketsecurity/lib-stable/stdio/header'
import { errorMessage } from './utils/error-message.mts'

const logger: Logger = getDefaultLogger()

type CleanTask = {
  name: string
  pattern?: string | undefined
  patterns?: string[] | undefined
}

type CleanOptions = {
  quiet?: boolean | undefined
}

type CleanScriptValues = FlagValues & {
  all: boolean
  cache: boolean
  coverage: boolean
  dist: boolean
  help: boolean
  modules: boolean
  quiet: boolean
  silent: boolean
  types: boolean
}

const rootPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)

/**
 * Clean specific directories.
 */
export async function cleanDirectories(
  tasks: CleanTask[],
  options: CleanOptions = {},
): Promise<number> {
  const { quiet = false } = options

  for (let i = 0, { length } = tasks; i < length; i += 1) {
    const task = tasks[i]
    const { name, pattern, patterns } = task
    const patternsToDelete: string[] = patterns || [pattern!]

    if (!quiet) {
      logger.progress(`Cleaning ${name}`)
    }

    try {
      // Find all files/dirs matching the patterns
      const files: string[] = await fastGlob(patternsToDelete, {
        cwd: rootPath,
        absolute: true,
        dot: true,
        onlyFiles: false,
        markDirectories: true,
      })

      // Delete each file/directory
      await deleteAsync(files)

      if (!quiet) {
        if (files.length > 0) {
          logger.done(`Cleaned ${name} (${files.length} items)`)
        } else {
          logger.done(`Cleaned ${name} (already clean)`)
        }
      }
    } catch (e) {
      if (!quiet) {
        logger.error(`Failed to clean ${name}`)
        const message = errorMessage(e)
        logger.fail(message)
      }
      return 1
    }
  }

  return 0
}

async function main(): Promise<void> {
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
      logger.log('Clean Runner')
      logger.log('')
      logger.log('Usage: pnpm clean [options]')
      logger.log('')
      logger.log('Options:')
      logger.log('  --help              Show this help message')
      logger.log('  --all               Clean everything (default if no flags)')
      logger.log('  --cache             Clean cache directories')
      logger.log('  --coverage          Clean coverage reports')
      logger.log('  --dist              Clean build output')
      logger.log('  --types             Clean TypeScript declarations only')
      logger.log('  --modules           Clean node_modules')
      logger.log('  --quiet, --silent   Suppress progress messages')
      logger.log('')
      logger.log('Examples:')
      logger.log(
        '  pnpm clean                  # Clean everything except node_modules',
      )
      logger.log('  pnpm clean --dist           # Clean build output only')
      logger.log('  pnpm clean --cache --coverage  # Clean cache and coverage')
      logger.log(
        '  pnpm clean --all --modules  # Clean everything including node_modules',
      )
      process.exitCode = 0
      return
    }

    const quiet: boolean = isQuiet(values as CleanScriptValues)

    // Determine what to clean
    const cleanAll: boolean =
      values.all ||
      (!values.cache &&
        !values.coverage &&
        !values.dist &&
        !values.types &&
        !values.modules)

    const tasks: CleanTask[] = []

    // Build task list
    if (cleanAll || values.cache) {
      tasks.push({ name: 'cache', pattern: '**/.cache' })
    }

    if (cleanAll || values.coverage) {
      tasks.push({ name: 'coverage', pattern: 'coverage' })
    }

    if (cleanAll || values.dist) {
      tasks.push({
        name: 'dist',
        patterns: ['dist', '*.tsbuildinfo', '.tsbuildinfo'],
      })
    } else if (values.types) {
      tasks.push({ name: 'dist/types', patterns: ['dist/types'] })
    }

    if (values.modules) {
      tasks.push({ name: 'node_modules', pattern: '**/node_modules' })
    }

    // Check if there's anything to clean
    if (tasks.length === 0) {
      if (!quiet) {
        logger.info('Nothing to clean')
      }
      process.exitCode = 0
      return
    }

    if (!quiet) {
      logger.log(
        createSectionHeader('Clean Runner', { width: 56, borderChar: '=' }),
      )
      logger.step('Cleaning project directories')
    }

    // Clean directories
    const exitCode: number = await cleanDirectories(tasks, { quiet })

    if (exitCode !== 0) {
      if (!quiet) {
        logger.error('Clean failed')
      }
      process.exitCode = exitCode
    } else {
      if (!quiet) {
        logger.success('Clean completed successfully!')
      }
    }
  } catch (e) {
    const message = errorMessage(e)
    logger.error(`Clean runner failed: ${message}`)
    process.exitCode = 1
  }
}

main().catch((e: unknown) => {
  logger.error(e)
  process.exitCode = 1
})
