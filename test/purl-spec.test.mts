/*!
Copyright (c) the purl authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

import fs from 'node:fs/promises'

import fastGlob from 'fast-glob'
import { describe, expect, it } from 'vitest'

import { PackageURL } from '../src/package-url.mjs'
import {
  PURL_SPEC_FIXTURE_DIR,
  PURL_SPEC_RULES_PATH,
  PURL_TEST_DATA_GLOB,
} from '../scripts/repo/paths.mts'
import { evaluatePurlCase } from '../scripts/repo/purl-spec/evaluate.mts'
import { loadPurlSpecCases } from '../scripts/repo/purl-spec/load.mts'
import { readPurlSpecSuite } from '../scripts/repo/purl-spec/read.mts'
import {
  applyPurlRuleCorrections,
  readPurlRuleCorrections,
} from '../scripts/repo/purl-spec/rules.mts'

describe('PackageURL published purl-spec rules', async () => {
  const cases = await loadPurlSpecCases(PURL_SPEC_FIXTURE_DIR)
  const corrections = readPurlRuleCorrections(
    JSON.parse(await fs.readFile(PURL_SPEC_RULES_PATH, 'utf8')),
  )
  const corrected = applyPurlRuleCorrections(cases, corrections)
  for (let index = 0, { length } = corrected; index < length; index += 1) {
    const entry = corrected[index]!
    it(`${entry.source} ${entry.index}: ${entry.test.test_group} ${entry.test.test_type}: ${entry.test.description}`, () => {
      expect(evaluatePurlCase(entry.test, PackageURL)).toMatchObject({
        passed: true,
      })
    })
  }
})

describe('PackageURL repo cases', async () => {
  const files = await fastGlob.glob(PURL_TEST_DATA_GLOB, { absolute: true })
  if (!files.length) {
    throw new Error('Missing repo-owned PURL fixtures.')
  }
  for (let index = 0, { length } = files; index < length; index += 1) {
    const filename = files[index]!
    const tests = readPurlSpecSuite(
      JSON.parse(await fs.readFile(filename, 'utf8')),
      filename,
    )
    for (const test of tests) {
      it(test.description, () => {
        expect(evaluatePurlCase(test, PackageURL)).toMatchObject({
          passed: true,
        })
      })
    }
  }
})
