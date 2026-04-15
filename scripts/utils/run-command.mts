/** @fileoverview Utility for running shell commands with proper error handling. */

import process from 'node:process'

import type { Logger } from '@socketsecurity/lib/logger'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import type {
  SpawnErrorWithOutputString,
  SpawnOptions,
  SpawnSyncOptions,
  SpawnSyncReturns,
} from '@socketsecurity/lib/spawn'
import { spawn, spawnSync } from '@socketsecurity/lib/spawn'

const logger: Logger = getDefaultLogger()

export type CommandOptions = SpawnOptions

export type CommandResult = {
  exitCode: number
  stderr: string
  stdout: string
}

export type SequenceEntry = {
  args?: string[]
  command: string
  options?: CommandOptions
}

/**
 * Run a command and return a promise that resolves with the exit code.
 */
export async function runCommand(
  command: string,
  args: string[] = [],
  options: CommandOptions = {},
): Promise<number> {
  try {
    const result = await spawn(command, args, {
      stdio: 'inherit',
      ...(process.platform === 'win32' && { shell: true }),
      ...options,
    })
    return result.code
  } catch (e) {
    // spawn() from @socketsecurity/lib throws on non-zero exit
    // Return the exit code from the error
    if (e && typeof e === 'object' && 'code' in e) {
      return e.code as number
    }
    throw e
  }
}

/**
 * Run a command synchronously.
 */
export function runCommandSync(
  command: string,
  args: string[] = [],
  options: SpawnSyncOptions = {},
): number {
  const result: SpawnSyncReturns<string | Buffer> = spawnSync(command, args, {
    stdio: 'inherit',
    ...(process.platform === 'win32' && { shell: true }),
    ...options,
  })

  return result.status || 0
}

/**
 * Run a pnpm script.
 */
export async function runPnpmScript(
  scriptName: string,
  extraArgs: string[] = [],
  options: CommandOptions = {},
): Promise<number> {
  return runCommand('pnpm', ['run', scriptName, ...extraArgs], options)
}

/**
 * Run multiple commands in sequence, stopping on first failure.
 */
export async function runSequence(commands: SequenceEntry[]): Promise<number> {
  for (const { args = [], command, options = {} } of commands) {
    const exitCode: number = await runCommand(command, args, options)
    if (exitCode !== 0) {
      return exitCode
    }
  }
  return 0
}

/**
 * Run multiple commands in parallel.
 */
export async function runParallel(
  commands: SequenceEntry[],
): Promise<number[]> {
  const promises: Array<Promise<number>> = commands.map(
    ({ args = [], command, options = {} }) =>
      runCommand(command, args, options),
  )
  const results: Array<PromiseSettledResult<number>> =
    await Promise.allSettled(promises)
  return results.map(r => (r.status === 'fulfilled' ? r.value : 1))
}

/**
 * Run a command and suppress output.
 */
export async function runCommandQuiet(
  command: string,
  args: string[] = [],
  options: CommandOptions = {},
): Promise<CommandResult> {
  try {
    const result = await spawn(command, args, {
      ...options,
      ...(process.platform === 'win32' && { shell: true }),
      stdio: 'pipe',
      stdioString: true,
    })

    return {
      exitCode: result.code,
      stderr: result.stderr as string,
      stdout: result.stdout as string,
    }
  } catch (e) {
    // spawn() from @socketsecurity/lib throws on non-zero exit
    // Return the exit code and output from the error
    if (
      e &&
      typeof e === 'object' &&
      'code' in e &&
      'stdout' in e &&
      'stderr' in e
    ) {
      const spawnError: SpawnErrorWithOutputString = e
      return {
        exitCode: spawnError.code,
        stderr: spawnError.stderr,
        stdout: spawnError.stdout,
      }
    }
    throw e
  }
}

/**
 * Log and run a command.
 */
export async function logAndRun(
  description: string,
  command: string,
  args: string[] = [],
  options: CommandOptions = {},
): Promise<number> {
  logger.log(description)
  return runCommand(command, args, options)
}
