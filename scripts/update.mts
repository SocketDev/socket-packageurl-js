/**
 * @fileoverview Monorepo-aware dependency update script.
 * Uses taze to update dependencies across all packages in the monorepo.
 *
 * Usage:
 *   node scripts/update.mts [options]
 *
 * Options:
 *   --quiet    Suppress progress output
 *   --verbose  Show detailed output
 */

import process from 'node:process'

import { isQuiet, isVerbose } from '@socketsecurity/lib/argv/flags'
import { WIN32 } from '@socketsecurity/lib/constants/platform'
import type { Logger } from '@socketsecurity/lib/logger'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import type { SpawnResult } from '@socketsecurity/lib/spawn'
import { spawn } from '@socketsecurity/lib/spawn'

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function main(): Promise<void> {
  const quiet: boolean = isQuiet()
  const verbose: boolean = isVerbose()
  const logger: Logger = getDefaultLogger()

  try {
    if (!quiet) {
      logger.log('\n🔨 Dependency Update\n')
    }

    // Build taze command with appropriate flags for monorepo
    const tazeArgs: string[] = ['exec', 'taze', '-r', '-w']

    if (!quiet) {
      logger.progress('Updating dependencies...')
    }

    // Run taze at root level (recursive flag will check all packages).
    const result: Awaited<SpawnResult> = await spawn('pnpm', tazeArgs, {
      shell: WIN32,
      stdio: quiet ? 'pipe' : 'inherit',
    })

    // Clear progress line.
    if (!quiet) {
      process.stdout.write('\r\x1b[K')
    }

    // Always update Socket packages (bypass taze maturity period).
    if (!quiet) {
      logger.progress('Updating Socket packages...')
    }

    const socketResult: Awaited<SpawnResult> = await spawn(
      'pnpm',
      [
        'update',
        '@socketsecurity/*',
        '@socketregistry/*',
        '@socketbin/*',
        '--latest',
        '-r',
      ],
      {
        shell: WIN32,
        stdio: quiet ? 'pipe' : 'inherit',
      },
    )

    // Clear progress line.
    if (!quiet) {
      process.stdout.write('\r\x1b[K')
    }

    if (socketResult.code !== 0) {
      if (!quiet) {
        logger.fail('Failed to update Socket packages')
      }
      process.exitCode = 1
      return
    }

    if (result.code !== 0) {
      if (!quiet) {
        logger.fail('Failed to update dependencies')
      }
      process.exitCode = 1
    } else {
      if (!quiet) {
        logger.success('Dependencies updated')
        logger.log('')
      }
    }
  } catch (error: unknown) {
    if (!quiet) {
      logger.fail(`Update failed: ${getErrorMessage(error)}`)
    }
    if (verbose) {
      logger.error(error)
    }
    process.exitCode = 1
  }
}

main().catch((error: unknown) => {
  const logger: Logger = getDefaultLogger()
  logger.error(error)
  process.exitCode = 1
})
