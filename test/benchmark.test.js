'use strict'

const assert = require('node:assert/strict')
const path = require('node:path')
const { describe, it } = require('node:test')

const { glob } = require('fast-glob')

const { readJson } = require('@socketsecurity/registry/lib/fs')
const { isObject } = require('@socketsecurity/registry/lib/objects')

const { PackageURL } = require('../src/package-url')

describe('PackageURL', () => {
  it('Benchmarking the library', async () => {
    const TEST_FILES = (
      await Promise.all(
        (
          await glob(['**/**.json'], {
            absolute: true,
            cwd: path.join(__dirname, 'data')
          })
        ).map(p => readJson(p))
      )
    )
      .filter(Boolean)
      .flatMap(o => o.tests ?? [])

    const iterations = 10000
    const data = TEST_FILES.filter(obj => isObject(obj.expected_output))
    const { length: dataLength } = data
    const objects = []
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
      const { expected_output } = obj
      const purl = new PackageURL(
        expected_output.type,
        expected_output.namespace,
        expected_output.name,
        expected_output.version,
        expected_output.qualifiers,
        expected_output.subpath
      )
      PackageURL.fromString(purl.toString())
    }
    const end = Date.now()
    console.log(
      `avg exec time of ${iterations} iterations (in ms): ${
        (end - start) / iterations
      }`
    )
    assert.ok(end - start > 0)
  })
})
