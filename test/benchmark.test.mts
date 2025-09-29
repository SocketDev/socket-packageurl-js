import path from 'node:path'

import { glob } from 'fast-glob'
import { describe, expect, it } from 'vitest'

import { readJson } from '@socketsecurity/registry/lib/fs'
import { isObject } from '@socketsecurity/registry/lib/objects'

import { PackageURL } from '../dist/package-url.js'

describe('PackageURL', () => {
  it('Benchmarking the library', async () => {
    const TEST_FILES = (
      await Promise.all(
        (
          await glob(['**/**.json'], {
            absolute: true,
            cwd: path.join(__dirname, 'data'),
          })
        ).map(p => readJson(p)),
      )
    )
      .filter(Boolean)
      .flatMap((o: any) => o?.tests ?? [])

    const iterations = 10000
    const data = TEST_FILES.filter((obj: any) => isObject(obj?.expected_output))
    const { length: dataLength } = data
    const objects: unknown[] = []
    for (let i = 0; i < iterations; i += dataLength) {
      const delta = iterations - (i + dataLength)
      if (delta < 0) {
        objects.push(...data.slice(0, delta))
      } else {
        objects.push(...data)
      }
    }
    const start = Date.now()
    for (let i = 0; i < iterations; i += 1) {
      const obj = objects[i]
      const expected_output = obj?.['expected_output']
      if (isObject(expected_output)) {
        const purl = new PackageURL(
          expected_output.type,
          expected_output.namespace,
          expected_output.name,
          expected_output.version,
          expected_output.qualifiers,
          expected_output.subpath,
        )
        PackageURL.fromString(purl.toString())
      }
    }
    const end = Date.now()
    console.log(
      `avg exec time of ${iterations} iterations (in ms): ${
        (end - start) / iterations
      }`,
    )
    expect(end - start > 0)
  })
})
