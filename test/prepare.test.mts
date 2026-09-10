import { expect, it } from 'vitest'

import { ensureWorkspacePackages } from '../scripts/repo/bootstrap/prepare.mts'

it('adds missing workspace entries and preserves existing entries idempotently', () => {
  const source = "packages:\n  - 'packages/*'\n\ncatalog:\n  example: 1.0.0\n"
  const required = ['packages/*', 'tools/*']
  const repaired = ensureWorkspacePackages(source, required)
  expect(repaired).toBe(
    "packages:\n  - 'packages/*'\n  - 'tools/*'\n\ncatalog:\n  example: 1.0.0\n",
  )
  expect(ensureWorkspacePackages(repaired, required)).toBe(repaired)
})
