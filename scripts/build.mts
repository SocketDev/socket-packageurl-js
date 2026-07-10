/**
 * @file Build runner. Wraps rolldown's programmatic API behind the same CLI
 *   surface (--src, --types, --watch, --analyze, --needed) the rest of the
 *   fleet's build scripts use.
 */

import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { rolldown, watch as rolldownWatch } from 'rolldown'
import type { RolldownOutput } from 'rolldown'
import colors from 'yoctocolors-cjs'

import { isQuiet } from '@socketsecurity/lib-stable/argv/flag-predicates'
import type { FlagValues } from '@socketsecurity/lib-stable/argv/flag-types'
import { parseArgs } from '@socketsecurity/lib-stable/argv/parse'
import { WIN32 } from '@socketsecurity/lib-stable/constants/platform'
import type { Logger } from '@socketsecurity/lib-stable/logger/types'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { printFooter } from '@socketsecurity/lib-stable/stdio/footer'
import { printHeader } from '@socketsecurity/lib-stable/stdio/header'
import { errorMessage } from './utils/error-message.mts'

const logger: Logger = getDefaultLogger()

import { configs as rolldownConfigs } from '../.config/repo/rolldown.config.mts'
import { runSequence } from './utils/run-command.mts'

type BuildAnalysis = {
  files: Array<{
    name: string
    size: string
  }>
  totalSize: string
}

type BuildScriptValues = FlagValues & {
  analyze: boolean
  help: boolean
  needed: boolean
  src: boolean
  types: boolean
  verbose: boolean
}

type BuildSourceOptions = {
  analyze?: boolean | undefined
  quiet?: boolean | undefined
  skipClean?: boolean | undefined
  verbose?: boolean | undefined
}

type BuildTypesOptions = {
  quiet?: boolean | undefined
  skipClean?: boolean | undefined
  verbose?: boolean | undefined
}

type WatchBuildOptions = {
  quiet?: boolean | undefined
  verbose?: boolean | undefined
}

type BuildSourceResult = {
  buildTime: number
  exitCode: number
  outputs: readonly RolldownOutput[]
}

type SequenceCommand = {
  args?: string[] | undefined
  command: string
  options?:
    | {
        shell?: boolean | undefined
      }
    | undefined
}

const rootPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)
const distPath = path.join(rootPath, 'dist')

/**
 * Build source code with rolldown. Returns { exitCode, buildTime, outputs } for
 * external logging.
 */
export async function buildSource(
  options: BuildSourceOptions = {},
): Promise<BuildSourceResult> {
  const { quiet = false, skipClean = false } = options

  if (!quiet) {
    logger.substep('Building source code')
  }

  if (!skipClean) {
    const exitCode = await runSequence([
      {
        args: ['scripts/clean.mts', '--dist', '--quiet'],
        command: 'node',
      },
    ])
    if (exitCode !== 0) {
      if (!quiet) {
        logger.error('Clean failed')
      }
      return { buildTime: 0, exitCode, outputs: [] }
    }
  }

  try {
    const startTime = Date.now()
    const outputs: RolldownOutput[] = []

    for (let i = 0, { length } = rolldownConfigs; i < length; i += 1) {
      const config = rolldownConfigs[i]
      const bundle = await rolldown(config)
      const output = config.output
      if (!output || Array.isArray(output)) {
        throw new Error('Expected single output config per entry')
      }
      const result = await bundle.write(output)
      outputs.push(result)
      await bundle.close()
    }

    return { buildTime: Date.now() - startTime, exitCode: 0, outputs }
  } catch (e) {
    if (!quiet) {
      logger.error('Source build failed')
      logger.fail(e)
    }
    return { buildTime: 0, exitCode: 1, outputs: [] }
  }
}

/**
 * Build TypeScript declarations. Returns exitCode for external logging.
 */
export async function buildTypes(
  options: BuildTypesOptions = {},
): Promise<number> {
  const {
    quiet = false,
    skipClean = false,
    verbose: _verbose = false,
  } = options

  if (!quiet) {
    logger.substep('Building TypeScript declarations')
  }

  const commands: SequenceCommand[] = []

  if (!skipClean) {
    commands.push({
      args: ['scripts/clean.mts', '--types', '--quiet'],
      command: 'node',
    })
  }

  commands.push({
    args: ['exec', 'tsgo', '--project', 'tsconfig.dts.json'],
    command: 'pnpm',
    options: {
      shell: WIN32,
    },
  })

  const exitCode = await runSequence(commands)

  if (exitCode !== 0) {
    if (!quiet) {
      logger.error('Type declarations build failed')
    }
  }

  return exitCode
}

/**
 * Walk the on-disk dist/ output and report file sizes. Replaces esbuild's
 * metafile analyzer — rolldown doesn't ship an equivalent metafile by default,
 * and the only consumer is this --analyze CLI flag, so reading the produced
 * files directly is enough.
 */
export function getBuildAnalysis(): BuildAnalysis {
  const files: Array<{ name: string; size: string }> = []
  let totalBytes = 0

  if (existsSync(distPath)) {
    for (const name of ['index.js', 'exists.js']) {
      const filePath = path.join(distPath, name)
      if (!existsSync(filePath)) {
        continue
      }
      const bytes = statSync(filePath).size
      totalBytes += bytes
      files.push({
        name: path.relative(rootPath, filePath),
        size: `${(bytes / 1024).toFixed(2)} KB`,
      })
    }
  }

  return {
    files,
    totalSize: `${(totalBytes / 1024).toFixed(2)} KB`,
  }
}

export function getErrorMessage(error: unknown): string {
  return errorMessage(error)
}

/**
 * Check if build is needed.
 */
export function isBuildNeeded(): boolean {
  const distIndexPath = path.join(rootPath, 'dist', 'index.js')
  const distTypesPath = path.join(rootPath, 'dist', 'types', 'index.d.ts')

  return !existsSync(distIndexPath) || !existsSync(distTypesPath)
}

/**
 * Watch mode for development with incremental builds (68% faster rebuilds).
 */
export async function watchBuild(
  options: WatchBuildOptions = {},
): Promise<number> {
  const { quiet = false, verbose = false } = options

  if (!quiet) {
    logger.step('Starting watch mode')
    logger.substep('Watching for file changes…')
  }

  try {
    const watchers = rolldownConfigs.map(config => rolldownWatch(config))

    for (let i = 0, { length } = watchers; i < length; i += 1) {
      const watcher = watchers[i]
      watcher.on('event', event => {
        if (event.code === 'BUNDLE_END' && !quiet) {
          logger.success(`Rebuild succeeded (${event.duration}ms)`)
          if (verbose) {
            const analysis = getBuildAnalysis()
            logger.info(`Bundle size: ${analysis.totalSize}`)
          }
        } else if (event.code === 'ERROR' && !quiet) {
          logger.error('Rebuild failed')
          logger.fail(event.error)
        }
      })
    }

    process.on('SIGINT', async (): Promise<never> => {
      await Promise.allSettled(watchers.map(w => w.close()))
      process.exitCode = 0
      throw new Error('Watch mode interrupted')
    })

    await new Promise<never>(() => {})
  } catch (e) {
    if (!quiet) {
      logger.error('Watch mode failed:', e)
    }
    return 1
  }
}

async function main(): Promise<void> {
  try {
    // Parse arguments
    const { values } = parseArgs<BuildScriptValues>({
      options: {
        help: {
          type: 'boolean',
          default: false,
        },
        src: {
          type: 'boolean',
          default: false,
        },
        types: {
          type: 'boolean',
          default: false,
        },
        watch: {
          type: 'boolean',
          default: false,
        },
        needed: {
          type: 'boolean',
          default: false,
        },
        analyze: {
          type: 'boolean',
          default: false,
        },
        silent: {
          type: 'boolean',
          default: false,
        },
        quiet: {
          type: 'boolean',
          default: false,
        },
        verbose: {
          type: 'boolean',
          default: false,
        },
      },
      allowPositionals: false,
      strict: false,
    })

    // Show help if requested
    if (values.help) {
      logger.log('Build Runner')
      logger.log('')
      logger.log('Usage: pnpm build [options]')
      logger.log('')
      logger.log('Options:')
      logger.log('  --help       Show this help message')
      logger.log('  --src        Build source code only')
      logger.log('  --types      Build TypeScript declarations only')
      logger.log('  --watch      Watch mode with incremental rebuilds')
      logger.log('  --needed     Only build if dist files are missing')
      logger.log('  --analyze    Show bundle size analysis')
      logger.log('  --quiet, --silent  Suppress progress messages')
      logger.log('  --verbose    Show detailed build output')
      logger.log('')
      logger.log('Examples:')
      logger.log('  pnpm build              # Full build (source + types)')
      logger.log('  pnpm build --src        # Build source only')
      logger.log('  pnpm build --types      # Build types only')
      logger.log('  pnpm build --watch      # Watch mode')
      logger.log('  pnpm build --analyze    # Build with size analysis')
      process.exitCode = 0
      return
    }

    const quiet = isQuiet(values)
    const verbose = values.verbose

    // Check if build is needed
    if (values.needed && !isBuildNeeded()) {
      if (!quiet) {
        logger.info('Build artifacts exist, skipping build')
      }
      process.exitCode = 0
      return
    }

    if (!quiet) {
      printHeader('Build Runner')
    }

    let exitCode = 0

    // Handle watch mode
    if (values.watch) {
      exitCode = await watchBuild({ quiet, verbose })
    }
    // Build types only
    else if (values.types && !values.src) {
      if (!quiet) {
        logger.step('Building TypeScript declarations only')
      }
      exitCode = await buildTypes({ quiet, verbose })
      if (exitCode === 0 && !quiet) {
        logger.substep('Type declarations built')
      }
    }
    // Build source only
    else if (values.src && !values.types) {
      if (!quiet) {
        logger.step('Building source only')
      }
      const { buildTime, exitCode: srcExitCode } = await buildSource({
        quiet,
        verbose,
        analyze: values.analyze,
      })
      exitCode = srcExitCode
      if (exitCode === 0 && !quiet) {
        logger.substep(`Source build complete in ${buildTime}ms`)

        if (values.analyze) {
          const analysis = getBuildAnalysis()
          logger.info('Build output:')
          for (const file of analysis.files) {
            logger.substep(`${file.name}: ${file.size}`)
          }
          logger.step(`Total bundle size: ${analysis.totalSize}`)
        }
      }
    }
    // Build everything (default)
    else {
      if (!quiet) {
        logger.step('Building package (source + types)')
      }

      // Clean all directories first (once)
      if (!quiet) {
        logger.substep('Cleaning build directories')
      }
      exitCode = await runSequence([
        {
          args: ['scripts/clean.mts', '--dist', '--types', '--quiet'],
          command: 'node',
        },
      ])
      if (exitCode !== 0) {
        if (!quiet) {
          logger.error('Clean failed')
        }
        process.exitCode = exitCode
        return
      }

      // Run source and types builds in parallel
      const results = await Promise.allSettled([
        buildSource({
          quiet,
          verbose,
          skipClean: true,
          analyze: values.analyze,
        }),
        buildTypes({ quiet, verbose, skipClean: true }),
      ])

      const srcResult: BuildSourceResult =
        results[0].status === 'fulfilled'
          ? results[0].value
          : { buildTime: 0, exitCode: 1, outputs: [] }
      const typesExitCode =
        results[1].status === 'fulfilled' ? results[1].value : 1

      // Log completion messages in order
      if (!quiet) {
        if (srcResult.exitCode === 0) {
          logger.substep(`Source build complete in ${srcResult.buildTime}ms`)

          if (values.analyze) {
            const analysis = getBuildAnalysis()
            logger.info('Build output:')
            for (const file of analysis.files) {
              logger.substep(`${file.name}: ${file.size}`)
            }
            logger.step(`Total bundle size: ${analysis.totalSize}`)
          }
        }

        if (typesExitCode === 0) {
          logger.substep('Type declarations built')
        }
      }

      exitCode = srcResult.exitCode !== 0 ? srcResult.exitCode : typesExitCode
    }

    // Print final status and footer
    if (!quiet) {
      if (exitCode === 0) {
        logger.log(colors.green('Build completed successfully!'))
      } else {
        logger.error(colors.red('Build failed'))
      }
      printFooter()
    }

    if (exitCode !== 0) {
      process.exitCode = exitCode
    }
  } catch (e) {
    logger.error(`Build runner failed: ${getErrorMessage(e)}`)
    process.exitCode = 1
  }
}

main().catch((error: unknown) => {
  logger.error(error)
  process.exitCode = 1
})
