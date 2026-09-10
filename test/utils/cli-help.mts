import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { expect } from 'vitest'

const root = fileURLToPath(new URL('../../', import.meta.url))

export function assertCliHelp(
  runner: string,
  options?: { usage?: string | undefined } | undefined,
): void {
  const script = fileURLToPath(
    new URL(`../../scripts/repo/${runner}.mts`, import.meta.url),
  )
  const result = spawnSync(process.execPath, [script, '--help'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 5000,
  })
  expect(result.error).toBeUndefined()
  expect(result.status).toBe(0)
  expect(result.stderr).toBe('')
  expect(result.stdout).toContain(
    options?.usage ?? `Usage: pnpm ${runner} [options]`,
  )
  if (runner === 'build' || runner === 'clean') {
    expect(result.stdout).toContain('--quiet')
  }
}
