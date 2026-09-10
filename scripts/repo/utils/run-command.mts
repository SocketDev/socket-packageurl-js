import { isWin32 } from '@socketsecurity/lib-stable/constants/platform'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import type { SpawnOptions } from '@socketsecurity/lib-stable/process/spawn/types'

export type CommandOptions = SpawnOptions
export type SequenceEntry = {
  args?: string[] | undefined
  command: string
  options?: CommandOptions | undefined
}

/**
 * Run a command and return a promise that resolves with the exit code.
 */
export async function runCommand(
  command: string,
  args: string[],
  options: CommandOptions = {},
): Promise<number> {
  try {
    const result = await spawn(command, args, {
      stdio: 'inherit',
      shell: isWin32(),
      ...options,
    })
    return result.code
  } catch (e) {
    // spawn() from @socketsecurity/lib-stable throws on non-zero exit
    // Return the exit code from the error
    if (typeof e === 'object' && e !== null && 'code' in e) {
      return e.code as number
    }
    throw e
  }
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
