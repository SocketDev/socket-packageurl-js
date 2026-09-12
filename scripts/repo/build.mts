/**
 * @file Build runner. Wraps rolldown's programmatic API behind the same CLI
 *   surface (--src, --types, --watch, --analyze, --needed) the rest of the
 *   fleet's build scripts use.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { rolldown, watch as rolldownWatch } from 'rolldown'
import type { RolldownOutput } from 'rolldown'
import colors from 'yoctocolors-cjs'

import { isWin32 } from '@socketsecurity/lib-stable/constants/platform'
import type { Logger } from '@socketsecurity/lib-stable/logger/logger'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { printFooter } from '@socketsecurity/lib-stable/stdio/footer'
import { printHeader } from '@socketsecurity/lib-stable/stdio/header'
import { errorMessage } from './utils/error-message.mts'

import { configs as rolldownConfigs } from '../../.config/repo/rolldown.config.mts'
import { parseBuildFlags } from './build-args.mts'
import { getBuildAnalysis } from './build-analysis.mts'
import { runSequence } from './utils/run-command.mts'

import { isMainModule } from '../fleet/process/is-main-module.mts'
import { runMain } from '../fleet/process/run-main.mts'

const logger: Logger = getDefaultLogger()

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
  '../..',
)
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
        args: ['scripts/repo/clean.mts', '--dist', '--quiet'],
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
      const config = rolldownConfigs[i]!
      const bundle = await rolldown(config)
      const output = config.output
      if (!output || Array.isArray(output)) {
        throw new Error('Expected single output config per entry')
      }
      const result = await bundle.write(output)
      outputs.push(result)
      await bundle.close()
    }

    // Post-build load gate: a bundle that crashes at require() must fail the
    // BUILD, not a later consumer. The staged-publish workflow runs
    // `pnpm run build` and then stages the tarball without running
    // `check --all`, so this is the last repo-owned check before npm — 1.4.5
    // shipped a dist/exists.js that threw at module load and every green
    // lane missed it because nothing ever loaded the built entry.
    const gateExitCode = await runSequence([
      {
        args: ['scripts/repo/check/dist-entries-are-requirable.mts'],
        command: 'node',
      },
    ])
    if (gateExitCode !== 0) {
      if (!quiet) {
        logger.error('Built entry points failed the load probe')
      }
      return {
        buildTime: Date.now() - startTime,
        exitCode: gateExitCode,
        outputs,
      }
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
      args: ['scripts/repo/clean.mts', '--types', '--quiet'],
      command: 'node',
    })
  }

  commands.push({
    args: ['exec', 'tsgo', '--project', 'tsconfig.dts.json'],
    command: 'pnpm',
    options: {
      shell: isWin32(),
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
      const watcher = watchers[i]!
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

    // Keep the process alive until interrupted; the SIGINT handler above
    // owns shutdown. Returning the never-resolving promise gives every code
    // path an explicit return value.
    return await new Promise<never>(() => {})
  } catch (e) {
    if (!quiet) {
      logger.error('Watch mode failed:', e)
    }
    return 1
  }
}

async function buildAll(config: BuildSourceOptions): Promise<number> {
  const { quiet, verbose, analyze } = {
    __proto__: null,
    ...config,
  } as typeof config
  if (!quiet) {
    logger.step('Building package (source + types)')
  }

  // Clean all directories first (once)
  if (!quiet) {
    logger.substep('Cleaning build directories')
  }
  let exitCode = await runSequence([
    {
      args: ['scripts/repo/clean.mts', '--dist', '--types', '--quiet'],
      command: 'node',
    },
  ])
  if (exitCode !== 0) {
    if (!quiet) {
      logger.error('Clean failed')
    }
    return exitCode
  }

  // Run source and types builds in parallel
  const results = await Promise.allSettled([
    buildSource({
      quiet,
      verbose,
      skipClean: true,
      analyze: analyze,
    }),
    buildTypes({ quiet, verbose, skipClean: true }),
  ])

  const srcResult: BuildSourceResult =
    results[0].status === 'fulfilled'
      ? results[0].value
      : { buildTime: 0, exitCode: 1, outputs: [] }
  const typesExitCode = results[1].status === 'fulfilled' ? results[1].value : 1

  // Log completion messages in order
  if (!quiet) {
    if (srcResult.exitCode === 0) {
      logger.substep(`Source build complete in ${srcResult.buildTime}ms`)

      if (analyze) {
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
  return exitCode
}

async function buildSourceOnly(config: BuildSourceOptions): Promise<number> {
  const { quiet, verbose, analyze } = {
    __proto__: null,
    ...config,
  } as typeof config
  if (!quiet) {
    logger.step('Building source only')
  }
  const { buildTime, exitCode: srcExitCode } = await buildSource({
    quiet,
    verbose,
    analyze: analyze,
  })
  const exitCode = srcExitCode
  if (exitCode === 0 && !quiet) {
    logger.substep(`Source build complete in ${buildTime}ms`)

    if (analyze) {
      const analysis = getBuildAnalysis()
      logger.info('Build output:')
      for (const file of analysis.files) {
        logger.substep(`${file.name}: ${file.size}`)
      }
      logger.step(`Total bundle size: ${analysis.totalSize}`)
    }
  }
  return exitCode
}

async function buildTypesOnly(config: BuildTypesOptions): Promise<number> {
  const { quiet, verbose } = config
  if (!quiet) {
    logger.step('Building TypeScript declarations only')
  }
  const exitCode = await buildTypes({ quiet, verbose })
  if (exitCode === 0 && !quiet) {
    logger.substep('Type declarations built')
  }
  return exitCode
}

async function main(): Promise<void> {
  try {
    const values = parseBuildFlags()

    const quiet = [values.quiet, values.silent].includes(true)
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
      exitCode = await buildTypesOnly({ quiet, verbose })
    }
    // Build source only
    else if (values.src && !values.types) {
      exitCode = await buildSourceOnly({
        quiet,
        verbose,
        analyze: values.analyze,
      })
    }
    // Build everything (default)
    else {
      exitCode = await buildAll({ quiet, verbose, analyze: values.analyze })
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

if (isMainModule(import.meta.url)) {
  runMain(main, {
    describe: 'builds source and type declarations',
    help: 'Build Runner\n\nUsage: pnpm build [options]\n\nOptions:\n  --help       Show this help message\n  --src        Build source code only\n  --types      Build TypeScript declarations only\n  --watch      Watch mode with incremental rebuilds\n  --needed     Only build if dist files are missing\n  --analyze    Show bundle size analysis\n  --quiet, --silent  Suppress progress messages\n  --verbose    Show detailed build output\n\nExamples:\n  pnpm build              # Full build (source + types)\n  pnpm build --src        # Build source only\n  pnpm build --types      # Build types only\n  pnpm build --watch      # Watch mode\n  pnpm build --analyze    # Build with size analysis',
    json: 'result',
  })
}
