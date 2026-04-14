/**
 * @fileoverview Fix script that runs lint with auto-fix enabled,
 * then runs security tools (zizmor, agentshield) if available.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { spawn } from '@socketsecurity/lib/spawn'

const rootPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)
const WIN32 = process.platform === 'win32'

async function runCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const spawnPromise = spawn(command, args, {
      stdio: 'inherit',
      cwd: rootPath,
      ...(WIN32 && { shell: true }),
      ...options,
    })

    const child = spawnPromise.process

    child.on('exit', code => {
      resolve(code || 0)
    })

    child.on('error', error => {
      reject(error)
    })
  })
}

async function main() {
  try {
    // Pass through to lint.mjs with --fix flag.
    const args = ['run', 'lint', '--fix', ...process.argv.slice(2)]
    const exitCode = await runCommand('pnpm', args)
    process.exitCode = exitCode

    // Run zizmor to fix GitHub Actions workflows if .github/ exists.
    const githubDir = path.join(rootPath, '.github')
    if (existsSync(githubDir)) {
      try {
        await runCommand('zizmor', ['--fix', '.github/'])
      } catch (e) {
        console.warn(`zizmor --fix warning: ${e.message}`)
      }
    }

    // Run agentshield scan --fix if .claude/ exists and the binary is available.
    const claudeDir = path.join(rootPath, '.claude')
    const agentshieldBin = path.join(
      rootPath,
      'node_modules',
      '.bin',
      'agentshield',
    )
    if (existsSync(claudeDir) && existsSync(agentshieldBin)) {
      try {
        await runCommand('pnpm', ['exec', 'agentshield', 'scan', '--fix'])
      } catch (e) {
        console.warn(`agentshield scan --fix warning: ${e.message}`)
      }
    }
  } catch (error) {
    console.error(`Fix script failed: ${error.message}`)
    process.exitCode = 1
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
