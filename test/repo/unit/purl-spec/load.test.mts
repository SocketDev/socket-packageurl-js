import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'

import { loadPurlSpecCases } from '../../../../scripts/repo/purl-spec/load.mts'

const temporary: string[] = []
const suite = {
  $schema: 'https://packageurl.org/schemas/purl-test.schema-0.2.json',
  tests: [
    {
      description: 'generic identity',
      test_group: 'required',
      test_type: 'validate',
      input: 'pkg:generic/widget',
      expected_output: 'pkg:generic/widget',
    },
  ],
}

afterEach(async () => {
  for (const directory of temporary.splice(0)) await safeDelete(directory)
})

async function createFixtures(): Promise<string> {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'purl-spec-loader-'),
  )
  temporary.push(directory)
  for (const group of ['spec', 'types']) {
    const nested = path.join(directory, group)
    await fs.mkdir(nested)
    await fs.writeFile(path.join(nested, 'fixture.json'), JSON.stringify(suite))
  }
  return directory
}

describe('loadPurlSpecCases', () => {
  it('loads each suite and retains its origin and case index', async () => {
    const directory = await createFixtures()
    expect(
      (await loadPurlSpecCases(directory)).map(entry => [
        entry.source,
        entry.index,
      ]),
    ).toEqual([
      ['spec/fixture.json', 0],
      ['types/fixture.json', 0],
    ])
  })

  it('rejects empty suites and malformed fixture files', async () => {
    const directory = await createFixtures()
    const file = path.join(directory, 'spec', 'fixture.json')
    await fs.writeFile(file, '{}')
    await expect(loadPurlSpecCases(directory)).rejects.toThrow()
    await safeDelete(file)
    await expect(loadPurlSpecCases(directory)).rejects.toThrow()
  })
})
