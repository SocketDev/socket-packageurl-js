import { cpSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'

import { PURL_SPEC_FIXTURE_DIR } from '../scripts/repo/paths.mts'
import { diffSuite } from '../scripts/repo/sync-purl-spec.mts'

const tmpDirs: string[] = []

function makeCheckout(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'purl-spec-sync-'))
  tmpDirs.push(root)
  cpSync(PURL_SPEC_FIXTURE_DIR, path.join(root, 'tests'), { recursive: true })
  return root
}

afterAll(async () => {
  for (let i = 0, { length } = tmpDirs; i < length; i += 1) {
    await safeDelete(tmpDirs[i]!)
  }
})

describe('diffSuite', () => {
  it('accepts a byte-identical pinned suite', () => {
    expect(diffSuite(makeCheckout())).toEqual([])
  })

  it('reports a changed upstream fixture', () => {
    const checkout = makeCheckout()
    const fixture = diffSuite(checkout)
    expect(fixture).toEqual([])

    const specDir = path.join(checkout, 'tests', 'spec')
    const firstName = readdirSync(specDir).toSorted()[0]!
    writeFileSync(path.join(specDir, firstName), '{}\n')

    expect(diffSuite(checkout)).toContainEqual({
      kind: 'changed',
      relPath: path.join('spec', firstName),
    })
  })
})
