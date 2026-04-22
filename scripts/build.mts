/**
 * @fileoverview Fast build runner using esbuild for smaller bundles and faster builds.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { build, context } from 'esbuild'
import type { BuildOptions, BuildResult, LogLevel, Metafile } from 'esbuild'
import colors from 'yoctocolors-cjs'

import { isQuiet } from '@socketsecurity/lib/argv/flags'
import type { FlagValues } from '@socketsecurity/lib/argv/flags'
import { parseArgs } from '@socketsecurity/lib/argv/parse'
import type { Logger } from '@socketsecurity/lib/logger'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { printFooter } from '@socketsecurity/lib/stdio/footer'
import { printHeader } from '@socketsecurity/lib/stdio/header'
import { errorMessage } from './utils/error-message.mts'

const logger: Logger = getDefaultLogger()

import {
  analyzeMetafile,
  buildConfig,
  watchConfig,
} from '../.config/esbuild.config.mjs'
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
  analyze?: boolean
  quiet?: boolean
  skipClean?: boolean
  verbose?: boolean
}

type BuildTypesOptions = {
  quiet?: boolean
  skipClean?: boolean
  verbose?: boolean
}

type WatchBuildOptions = {
  quiet?: boolean
  verbose?: boolean
}

type BuildSourceResult = {
  buildTime: number
  exitCode: number
  result: BuildResult | null
}

type WatchConfig = BuildOptions & {
  watch?: Record<string, never>
}

type SequenceCommand = {
  args?: string[]
  command: string
  options?: {
    shell?: boolean
  }
}

const rootPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)

function getErrorMessage(error: unknown): string {
  return errorMessage(error)
}

function getLogLevel(quiet: boolean, verbose: boolean): LogLevel {
  return quiet ? 'silent' : verbose ? 'info' : 'warning'
}

function getBuildAnalysis(metafile: Metafile): BuildAnalysis {
  return analyzeMetafile(metafile) as BuildAnalysis
}

/**
 * Build source code with esbuild.
 * Returns { exitCode, buildTime, result } for external logging.
 */
async function buildSource(
  options: BuildSourceOptions = {},
): Promise<BuildSourceResult> {
  const { quiet = false, skipClean = false, verbose = false } = options

  if (!quiet) {
    logger.substep('Building source code')
  }

  // Clean dist directory if needed
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
      return { exitCode, buildTime: 0, result: null }
    }
  }

  try {
    const startTime = Date.now()
    const logLevel = getLogLevel(quiet, verbose)
    const result = await build({
      ...(buildConfig as BuildOptions),
      logLevel,
    })
    const buildTime = Date.now() - startTime

    return { exitCode: 0, buildTime, result }
  } catch (error) {
    if (!quiet) {
      logger.error('Source build failed')
      console.error(error)
    }
    return { exitCode: 1, buildTime: 0, result: null }
  }
}

/**
 * Build TypeScript declarations.
 * Returns exitCode for external logging.
 */
async function buildTypes(options: BuildTypesOptions = {}): Promise<number> {
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
    args: ['exec', 'tsgo', '--project', '.config/tsconfig.dts.json'],
    command: 'pnpm',
    options: {
      ...(process.platform === 'win32' && { shell: true }),
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
 * Watch mode for development with incremental builds (68% faster rebuilds).
 */
async function watchBuild(options: WatchBuildOptions = {}): Promise<number> {
  const { quiet = false, verbose = false } = options

  if (!quiet) {
    logger.step('Starting watch mode with incremental builds')
    logger.substep('Watching for file changes...')
  }

  try {
    const logLevel: LogLevel = quiet ? 'silent' : verbose ? 'debug' : 'warning'

    // Use context API for incremental builds (68% faster rebuilds)
    // Extract watch option from watchConfig as it's not valid for context()
    const { watch: _watchOpts, ...contextConfig } = watchConfig as WatchConfig
    const ctx = await context({
      ...contextConfig,
      logLevel,
      plugins: [
        ...(contextConfig.plugins || []),
        {
          name: 'rebuild-logger',
          setup(pluginBuild): void {
            pluginBuild.onEnd((result): void => {
              if (result.errors.length > 0) {
                if (!quiet) {
                  logger.error('Rebuild failed')
                }
              } else {
                if (!quiet) {
                  logger.success('Rebuild succeeded')
                  if (result?.metafile && verbose) {
                    const analysis = getBuildAnalysis(result.metafile)
                    logger.info(`Bundle size: ${analysis.totalSize}`)
                  }
                }
              }
            })
          },
        },
      ],
    })

    // Enable watch mode
    await ctx.watch()

    // Keep the process alive
    process.on('SIGINT', async (): Promise<never> => {
      await ctx.dispose()
      process.exitCode = 0
      throw new Error('Watch mode interrupted')
    })

    // Wait indefinitely
    await new Promise<never>(() => {})
  } catch (error) {
    if (!quiet) {
      logger.error('Watch mode failed:', error)
    }
    return 1
  }
}

/**
 * Check if build is needed.
 */
function isBuildNeeded(): boolean {
  const distPath = path.join(rootPath, 'dist', 'index.js')
  const distTypesPath = path.join(rootPath, 'dist', 'types', 'index.d.ts')

  return !existsSync(distPath) || !existsSync(distTypesPath)
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
      console.log('Build Runner')
      console.log('\nUsage: pnpm build [options]')
      console.log('\nOptions:')
      console.log('  --help       Show this help message')
      console.log('  --src        Build source code only')
      console.log('  --types      Build TypeScript declarations only')
      console.log(
        '  --watch      Watch mode with incremental builds (68% faster rebuilds)',
      )
      console.log('  --needed     Only build if dist files are missing')
      console.log('  --analyze    Show bundle size analysis')
      console.log('  --quiet, --silent  Suppress progress messages')
      console.log('  --verbose    Show detailed build output')
      console.log('\nExamples:')
      console.log('  pnpm build              # Full build (source + types)')
      console.log('  pnpm build --src        # Build source only')
      console.log('  pnpm build --types      # Build types only')
      console.log(
        '  pnpm build --watch      # Watch mode with incremental builds',
      )
      console.log('  pnpm build --analyze    # Build with size analysis')
      console.log(
        '\nNote: Watch mode uses esbuild context API for 68% faster rebuilds',
      )
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
      const {
        buildTime,
        exitCode: srcExitCode,
        result,
      } = await buildSource({ quiet, verbose, analyze: values.analyze })
      exitCode = srcExitCode
      if (exitCode === 0 && !quiet) {
        logger.substep(`Source build complete in ${buildTime}ms`)

        if (values.analyze && result?.metafile) {
          const analysis = getBuildAnalysis(result.metafile)
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

      const srcResult =
        results[0].status === 'fulfilled'
          ? results[0].value
          : { exitCode: 1, buildTime: 0, result: null }
      const typesExitCode =
        results[1].status === 'fulfilled' ? results[1].value : 1

      // Log completion messages in order
      if (!quiet) {
        if (srcResult.exitCode === 0) {
          logger.substep(`Source build complete in ${srcResult.buildTime}ms`)

          if (values.analyze && srcResult.result?.metafile) {
            const analysis = getBuildAnalysis(srcResult.result.metafile)
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
        console.log(colors.green('✓ Build completed successfully!'))
      } else {
        console.error(colors.red('✗ Build failed'))
      }
      printFooter()
    }

    if (exitCode !== 0) {
      process.exitCode = exitCode
    }
  } catch (error) {
    logger.error(`Build runner failed: ${getErrorMessage(error)}`)
    process.exitCode = 1
  }
}

main().catch((error: unknown) => {
  logger.error(error)
  process.exitCode = 1
})
