import fs from 'node:fs/promises'
import path from 'node:path'

import { compareStr } from '@socketsecurity/lib-stable/sorts/strings'

import { readPurlSpecSuite } from './read.mts'
import type { SpecTest } from './read.mts'

export interface PurlSpecCase {
  source: string
  index: number
  test: SpecTest
}

export async function loadPurlSpecCases(
  directory: string,
): Promise<PurlSpecCase[]> {
  const cases: PurlSpecCase[] = []
  for (const group of ['spec', 'types']) {
    const suiteDir = path.join(directory, group)
    const filenames = (await fs.readdir(suiteDir))
      .filter(filename => filename.endsWith('.json'))
      .toSorted(compareStr)
    if (!filenames.length) {
      throw new Error(
        `Missing PURL fixtures. Where: ${suiteDir}. Saw: no JSON files; wanted: a complete corpus. Fix: run sync-purl-spec.`,
      )
    }
    for (let index = 0, { length } = filenames; index < length; index += 1) {
      const filename = filenames[index]!
      const file = path.join(suiteDir, filename)
      const tests = readPurlSpecSuite(
        JSON.parse(await fs.readFile(file, 'utf8')),
        file,
      )
      for (
        let testIndex = 0, { length: testCount } = tests;
        testIndex < testCount;
        testIndex += 1
      ) {
        cases.push({
          source: `${group}/${filename}`,
          index: testIndex,
          test: tests[testIndex]!,
        })
      }
    }
  }
  return cases
}
