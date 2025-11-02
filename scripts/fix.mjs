/**
 * @fileoverview Fix script that runs lint with auto-fix enabled.
 */

import path from 'node:path'
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
    // Pass through to lint.mjs with --fix flag
    const args = ['run', 'lint', '--fix', ...process.argv.slice(2)]
    const exitCode = await runCommand('pnpm', args)
    process.exitCode = exitCode
  } catch (error) {
    console.error(`Fix script failed: ${error.message}`)
    process.exitCode = 1
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
