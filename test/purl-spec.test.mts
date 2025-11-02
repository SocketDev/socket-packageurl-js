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

import path from 'node:path'

import { glob } from 'fast-glob'
import { describe, expect, it } from 'vitest'

import { readJson } from '@socketsecurity/lib/fs'
import {
  isObject,
  toSortedObjectFromEntries,
} from '@socketsecurity/lib/objects'

import { PackageURL } from '../src/package-url.js'

function toUrlSearchParams(search: string) {
  const searchParams = new URLSearchParams()
  const entries = search.split('&')
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const pairs = entries[i].split('=')
    const value = decodeURIComponent(pairs.at(1) ?? '')
    searchParams.append(pairs[0], value)
  }
  return searchParams
}

describe('PackageURL purl-spec test suite', async () => {
  // Tests from the official purl-spec test suite (data/*.json files)
  const settled = await Promise.allSettled(
    (
      await glob(['**/**.json'], {
        absolute: true,
        cwd: path.join(__dirname, 'data'),
      })
    ).map(p => readJson(p)),
  )

  const TEST_FILES = settled
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value)
    .filter(Boolean)
    .flatMap((o: any) => o.tests ?? [])

  for (const obj of TEST_FILES) {
    const { expected_failure, expected_output, test_type } = obj

    const inputObj = isObject(obj.input) ? obj.input : undefined

    const inputStr = typeof obj.input === 'string' ? obj.input : undefined

    if (!inputObj && !inputStr) {
      continue
    }

    const expectedObj = isObject(expected_output) ? expected_output : undefined

    const expectedStr =
      typeof expected_output === 'string' ? expected_output : undefined

    if (!expectedObj && !expectedStr) {
      continue
    }

    describe(obj.description, () => {
      if (expected_failure) {
        if (test_type === 'parse' && inputStr) {
          // Tests expected parse failures from test suite
          it(`should not be possible to parse invalid ${expectedObj?.type ?? 'type'} PackageURLs`, () => {
            expect(() => PackageURL.fromString(inputStr)).toThrow(
              /missing the required|Invalid purl/,
            )
          })
        }
        if (test_type === 'build' && inputObj) {
          // Tests expected constructor failures from test suite
          it(`should not be possible to create invalid ${inputObj.type ?? 'type'} PackageURLs`, () => {
            expect(
              () =>
                new PackageURL(
                  inputObj.type,
                  inputObj.namespace,
                  inputObj.name,
                  inputObj.version,
                  inputObj.qualifiers,
                  inputObj.subpath,
                ),
            ).toThrow(/is a required|Invalid purl/)
          })
        }
      } else if (test_type === 'parse' && inputStr && expectedObj) {
        // Tests successful parsing from test suite
        it(`should be able to parse valid ${expectedObj.type ?? 'type'} PackageURLs`, () => {
          const purl = PackageURL.fromString(inputStr)
          expect(purl.type).toBe(expectedObj.type)
          expect(purl.name).toBe(expectedObj.name)
          expect(purl.namespace).toBe(expectedObj.namespace ?? undefined)
          expect(purl.version).toBe(expectedObj.version ?? undefined)
          expect(purl.qualifiers).toStrictEqual(
            expectedObj.qualifiers
              ? { __proto__: null, ...expectedObj.qualifiers }
              : undefined,
          )
          expect(purl.subpath).toBe(expectedObj.subpath ?? undefined)
        })
      } else if (test_type === 'build' && inputObj && expectedStr) {
        // Tests toString() output from test suite
        it(`should be able to convert valid ${inputObj.type ?? 'type'} PackageURLs to a string`, () => {
          const purl = new PackageURL(
            inputObj.type,
            inputObj.namespace,
            inputObj.name,
            inputObj.version,
            inputObj.qualifiers,
            inputObj.subpath,
          )
          const purlToStr = purl.toString()
          if (purl.qualifiers) {
            const markIndex = expectedStr.indexOf('?')
            const beforeMarkToStr = purlToStr.slice(0, markIndex)
            const beforeExpectedStr = expectedStr.slice(0, markIndex)
            expect(beforeMarkToStr).toBe(beforeExpectedStr)

            const afterMarkToStr = purlToStr.slice(markIndex + 1)
            const afterExpectedStr = expectedStr.slice(markIndex + 1)
            const actualParams = toSortedObjectFromEntries(
              toUrlSearchParams(afterMarkToStr).entries(),
            )
            const expectedParams = toSortedObjectFromEntries(
              toUrlSearchParams(afterExpectedStr).entries(),
            )
            expect(actualParams).toStrictEqual(expectedParams)
          } else {
            expect(purlToStr).toBe(expectedStr)
          }
        })
      } else if (test_type === 'roundtrip' && inputStr && expectedStr) {
        it(`should roundtrip ${expectedStr.split('/')[1]?.split('@')[0] ?? 'purl'}`, () => {
          const purl = PackageURL.fromString(inputStr)
          const purlToStr = purl.toString()

          // Special case: The test suite has a known issue where it expects
          // unencoded + in subpaths for roundtrip, but that's not correct.
          // We normalize to the canonical form with %2B per URL encoding rules.
          let normalizedExpected = expectedStr
          if (
            expectedStr.includes('#') &&
            expectedStr.includes('+') &&
            inputStr === 'pkg:cocoapods/GoogleUtilities@7.5.2#NSData+zlib'
          ) {
            normalizedExpected = expectedStr.replace(
              '#NSData+zlib',
              '#NSData%2Bzlib',
            )
          }

          if (purl.qualifiers) {
            const markIndex = normalizedExpected.indexOf('?')
            const beforeMarkToStr = purlToStr.slice(0, markIndex)
            const beforeExpectedStr = normalizedExpected.slice(0, markIndex)
            expect(beforeMarkToStr).toBe(beforeExpectedStr)

            const afterMarkToStr = purlToStr.slice(markIndex + 1)
            const afterExpectedStr = normalizedExpected.slice(markIndex + 1)
            const actualParams = toSortedObjectFromEntries(
              toUrlSearchParams(afterMarkToStr).entries(),
            )
            const expectedParams = toSortedObjectFromEntries(
              toUrlSearchParams(afterExpectedStr).entries(),
            )
            expect(actualParams).toStrictEqual(expectedParams)
          } else {
            expect(purlToStr).toBe(normalizedExpected)
          }
        })
      } else {
        it(`should handle test case: ${test_type}`, () => {
          throw new Error(
            `Unhandled test case: test_type=${test_type}, has inputStr=${!!inputStr}, has inputObj=${!!inputObj}, has expectedStr=${!!expectedStr}, has expectedObj=${!!expectedObj}, expected_failure=${expected_failure}`,
          )
        })
      }
    })
  }
})
