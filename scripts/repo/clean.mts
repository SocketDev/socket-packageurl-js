/**
 * @file Unified clean runner with flag-based configuration. Removes build
 *   artifacts, caches, and other generated files.
 */

import path from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'

import { deleteAsync } from 'del'
import fastGlob from 'fast-glob'

import type { Logger } from '@socketsecurity/lib-stable/logger/logger'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { createSectionHeader } from '@socketsecurity/lib-stable/stdio/header'
import { errorMessage } from './utils/error-message.mts'

import { isMainModule } from '../fleet/process/is-main-module.mts'
import { runMain } from '../fleet/process/run-main.mts'

const logger: Logger = getDefaultLogger()

type CleanTask = {
  name: string
  pattern?: string | undefined
  patterns?: string[] | undefined
}

type CleanOptions = {
  quiet?: boolean | undefined
}

const rootPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
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
    const task = tasks[i]!
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

function cleanTasks(
  values: Record<
    'all' | 'cache' | 'coverage' | 'dist' | 'types' | 'modules',
    boolean
  >,
): CleanTask[] {
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
    // oxlint-disable-next-line socket/prefer-repo-root-dot-cache -- this is a deletion target glob, not a new cache path; matches stale .cache dirs anywhere in the tree.
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

  return tasks
}

async function main(): Promise<void> {
  try {
    // Parse arguments
    const { values: parsed } = parseArgs({
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
    const values = {
      help: Boolean(parsed.help),
      all: Boolean(parsed.all),
      cache: Boolean(parsed.cache),
      coverage: Boolean(parsed.coverage),
      dist: Boolean(parsed.dist),
      types: Boolean(parsed.types),
      modules: Boolean(parsed.modules),
      quiet: Boolean(parsed.quiet),
      silent: Boolean(parsed.silent),
    }

    const quiet: boolean = values.quiet || values.silent

    const tasks = cleanTasks(values)

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

if (isMainModule(import.meta.url)) {
  runMain(main, {
    describe: 'removes selected generated outputs',
    help: 'Clean Runner\n\nUsage: pnpm clean [options]\n\nOptions:\n  --help              Show this help message\n  --all               Clean everything (default if no flags)\n  --cache             Clean cache directories\n  --coverage          Clean coverage reports\n  --dist              Clean build output\n  --types             Clean TypeScript declarations only\n  --modules           Clean node_modules\n  --quiet, --silent   Suppress progress messages\n\nExamples:\n  pnpm clean                  # Clean everything except node_modules\n  pnpm clean --dist           # Clean build output only\n  pnpm clean --cache --coverage  # Clean cache and coverage\n  pnpm clean --all --modules  # Clean everything including node_modules',
    json: 'result',
  })
}
