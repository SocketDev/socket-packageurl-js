/**
 * @fileoverview CI validation script for publishing workflow.
 * Runs test, check, and build steps in sequence.
 */

import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import type { Logger } from '@socketsecurity/lib/logger'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import type { SpawnResult } from '@socketsecurity/lib/spawn'
import { spawn } from '@socketsecurity/lib/spawn'
import { printHeader } from '@socketsecurity/lib/stdio/header'

const logger: Logger = getDefaultLogger()

const __dirname: string = path.dirname(fileURLToPath(import.meta.url))
const rootPath: string = path.resolve(__dirname, '..')

async function runCommand(
  command: string,
  args: string[] = [],
): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const spawnPromise: SpawnResult = spawn(command, args, {
      cwd: rootPath,
      stdio: 'inherit',
    })

    const child = spawnPromise.process

    child.on('exit', (code: number | null) => {
      resolve(code || 0)
    })

    child.on('error', (e: unknown) => {
      reject(e)
    })
  })
}

async function main(): Promise<void> {
  try {
    printHeader('CI Validation')

    // Run tests
    logger.step('Running tests')
    let exitCode: number = await runCommand('pnpm', ['test', '--all'])
    if (exitCode !== 0) {
      logger.error('Tests failed')
      process.exitCode = exitCode
      return
    }
    logger.success('Tests passed')

    // Run checks
    logger.step('Running checks')
    exitCode = await runCommand('pnpm', ['check', '--all'])
    if (exitCode !== 0) {
      logger.error('Checks failed')
      process.exitCode = exitCode
      return
    }
    logger.success('Checks passed')

    // Run build
    logger.step('Building project')
    exitCode = await runCommand('pnpm', ['build'])
    if (exitCode !== 0) {
      logger.error('Build failed')
      process.exitCode = exitCode
      return
    }
    logger.success('Build completed')

    logger.success('CI validation completed successfully!')
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    logger.error(`CI validation failed: ${message}`)
    process.exitCode = 1
  }
}

main().catch((e: unknown) => {
  const message = e instanceof Error ? e.message : String(e)
  logger.error(`CI validation crashed: ${message}`)
  process.exitCode = 1
})
