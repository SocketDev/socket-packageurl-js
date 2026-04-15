/**
 * @fileoverview Auto-fix script — runs linters with --fix, then security
 * tools (zizmor, agentshield) if available.
 *
 * Steps:
 *   1. pnpm run lint --fix — oxlint + oxfmt
 *   2. zizmor --fix .github/ — GitHub Actions workflow fixes (if .github/ exists)
 *   3. agentshield scan --fix — Claude config fixes (if .claude/ exists)
 */

import { existsSync } from 'node:fs'
import process from 'node:process'

import type { Logger } from '@socketsecurity/lib/logger'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import type { SpawnResult } from '@socketsecurity/lib/spawn'
import { spawn } from '@socketsecurity/lib/spawn'

const WIN32 = process.platform === 'win32'
const logger: Logger = getDefaultLogger()

type RunOptions = {
  label?: string
  required?: boolean
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function run(
  cmd: string,
  args: string[],
  { label, required = true }: RunOptions = {},
): Promise<number> {
  try {
    const result: Awaited<SpawnResult> = await spawn(cmd, args, {
      shell: WIN32,
      stdio: 'inherit',
    })
    if (result.code !== 0 && required) {
      logger.error(`${label || cmd} failed (exit ${result.code})`)
      return result.code
    }
    if (result.code !== 0) {
      // Non-blocking: log warning and continue.
      logger.warn(`${label || cmd}: exited ${result.code} (non-blocking)`)
    }
    return 0
  } catch (error) {
    if (!required) {
      logger.warn(`${label || cmd}: ${getErrorMessage(error)} (non-blocking)`)
      return 0
    }
    throw error
  }
}

async function main(): Promise<void> {
  const extraArgs: string[] = process.argv.slice(2)

  // Step 1: Lint fix — delegates to per-package lint scripts.
  const lintExit = await run('pnpm', ['run', 'lint', '--fix', ...extraArgs], {
    label: 'lint --fix',
  })
  if (lintExit) {
    process.exitCode = lintExit
  }

  // Step 2: zizmor — fixes GitHub Actions workflow security issues.
  // Only runs if .github/ directory exists (some repos don't have workflows).
  if (existsSync('.github')) {
    await run('zizmor', ['--fix', '.github/'], {
      label: 'zizmor --fix',
      required: false,
    })
  }

  // Step 3: AgentShield — fixes Claude config security findings.
  // Only runs if .claude/ exists and agentshield binary is installed.
  if (existsSync('.claude') && existsSync('node_modules/.bin/agentshield')) {
    await run('pnpm', ['exec', 'agentshield', 'scan', '--fix'], {
      label: 'agentshield --fix',
      required: false,
    })
  }
}

main().catch((error: unknown) => {
  logger.error(error)
  process.exitCode = 1
})
