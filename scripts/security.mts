/**
 * @fileoverview Security scan runner. Runs agentshield on Claude config then
 * optionally runs zizmor against .github/. Cross-platform replacement for the
 * previous inline shell script.
 */

import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import type { Logger } from '@socketsecurity/lib/logger'
import { spawnSync } from '@socketsecurity/lib/spawn'

import { runCommand } from './utils/run-command.mts'

const logger: Logger = getDefaultLogger()

function hasCommand(command: string): boolean {
  const probe = process.platform === 'win32' ? 'where' : 'command'
  const args = process.platform === 'win32' ? [command] : ['-v', command]
  const result = spawnSync(probe, args, {
    stdio: 'ignore',
    shell: process.platform === 'win32',
  })
  return result.status === 0
}

async function main(): Promise<void> {
  const agentshieldCode = await runCommand('agentshield', ['scan'])
  if (agentshieldCode !== 0) {
    process.exitCode = agentshieldCode
    return
  }

  if (hasCommand('zizmor')) {
    const zizmorCode = await runCommand('zizmor', ['.github/'])
    if (zizmorCode !== 0) {
      process.exitCode = zizmorCode
      return
    }
  } else {
    logger.info('zizmor not installed — run pnpm run setup to install')
  }

  process.exitCode = 0
}

void main().catch((e: unknown) => {
  const message = e instanceof Error ? e.message : String(e)
  logger.error(`security scan failed: ${message}`)
  process.exitCode = 1
})
