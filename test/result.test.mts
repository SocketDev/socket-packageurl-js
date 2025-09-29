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

/**
 * @fileoverview Unit tests for Result type and functional error handling.
 */
import { describe, expect, it } from 'vitest'

import { PackageURL } from '../dist/package-url.js'
import { Err, Ok, ResultUtils, err, ok } from '../dist/result.js'

describe('Result types', () => {
  describe('Ok', () => {
    it('should create Ok result', () => {
      const result = ok('success')

      expect(result).toBeInstanceOf(Ok)
      expect(result.kind).toBe('ok')
      expect(result.value).toBe('success')
      expect(result.isOk()).toBe(true)
      expect(result.isErr()).toBe(false)
    })

    it('should unwrap successfully', () => {
      const result = ok(42)

      expect(result.unwrap()).toBe(42)
      expect(result.unwrapOr(0)).toBe(42)
      expect(result.unwrapOrElse(() => 0)).toBe(42)
    })

    it('should map value correctly', () => {
      const result = ok(5)
      const mapped = result.map(x => x * 2)

      expect(mapped.isOk()).toBe(true)
      expect(mapped.unwrap()).toBe(10)
    })

    it('should pass through mapErr', () => {
      const result = ok(5)
      const mapped = result.mapErr(_e => new Error('new error'))

      expect(mapped.isOk()).toBe(true)
      expect(mapped.unwrap()).toBe(5)
    })

    it('should chain andThen operations', () => {
      const result = ok(5)
      const chained = result.andThen(x => ok(x * 2))

      expect(chained.isOk()).toBe(true)
      expect(chained.unwrap()).toBe(10)
    })

    it('should handle andThen with error result', () => {
      const result = ok(5)
      const chained = result.andThen(_x => err(new Error('failed')))

      expect(chained.isErr()).toBe(true)
      expect(chained.error).toEqual(new Error('failed'))
    })

    it('should pass through orElse', () => {
      const result = ok(5)
      const fallback = result.orElse(() => ok(10))

      expect(fallback.isOk()).toBe(true)
      expect(fallback.unwrap()).toBe(5)
    })
  })

  describe('Err', () => {
    it('should create Err result', () => {
      const error = new Error('failure')
      const result = err(error)

      expect(result).toBeInstanceOf(Err)
      expect(result.kind).toBe('err')
      expect(result.error).toBe(error)
      expect(result.isOk()).toBe(false)
      expect(result.isErr()).toBe(true)
    })

    it('should throw on unwrap', () => {
      const error = new Error('failure')
      const result = err(error)

      expect(() => result.unwrap()).toThrow('failure')
    })

    it('should throw on unwrap with string error', () => {
      const result = err('failure')

      expect(() => result.unwrap()).toThrow('failure')
    })

    it('should return defaults', () => {
      const result = err(new Error('failure'))

      expect(result.unwrapOr(42)).toBe(42)
      expect(result.unwrapOrElse(_e => _e.message.length)).toBe(7)
    })

    it('should pass through map', () => {
      const result = err(new Error('failure'))
      const mapped = result.map(x => x * 2)

      expect(mapped.isErr()).toBe(true)
      expect(mapped.error).toEqual(new Error('failure'))
    })

    it('should map error correctly', () => {
      const result = err(new Error('original'))
      const mapped = result.mapErr(e => new Error('mapped: ' + e.message))

      expect(mapped.isErr()).toBe(true)
      expect(mapped.error.message).toBe('mapped: original')
    })

    it('should pass through andThen', () => {
      const result = err(new Error('failure'))
      const chained = result.andThen(x => ok(x * 2))

      expect(chained.isErr()).toBe(true)
      expect(chained.error).toEqual(new Error('failure'))
    })

    it('should handle orElse', () => {
      const result = err(new Error('failure'))
      const fallback = result.orElse(() => ok(42))

      expect(fallback.isOk()).toBe(true)
      expect(fallback.unwrap()).toBe(42)
    })

    it('should handle orElse with error', () => {
      const result = err(new Error('failure'))
      const fallback = result.orElse(() => err(new Error('fallback failed')))

      expect(fallback.isErr()).toBe(true)
      expect(fallback.error.message).toBe('fallback failed')
    })
  })

  describe('Result utilities', () => {
    it('should wrap throwing function', () => {
      const throwingFn = () => {
        throw new Error('boom')
      }
      const result = ResultUtils.from(throwingFn)

      expect(result.isErr()).toBe(true)
      expect(result.error.message).toBe('boom')
    })

    it('should wrap non-throwing function', () => {
      const safeFn = () => 42
      const result = ResultUtils.from(safeFn)

      expect(result.isOk()).toBe(true)
      expect(result.unwrap()).toBe(42)
    })

    it('should wrap function that throws non-Error', () => {
      const throwingFn = () => {
        throw 'string error'
      }
      const result = ResultUtils.from(throwingFn)

      expect(result.isErr()).toBe(true)
      expect(result.error).toBeInstanceOf(Error)
      expect(result.error.message).toBe('string error')
    })

    it('should handle all successful results', () => {
      const results = [ok(1), ok(2), ok(3)]
      const combined = ResultUtils.all(results)

      expect(combined.isOk()).toBe(true)
      expect(combined.unwrap()).toEqual([1, 2, 3])
    })

    it('should handle all with one error', () => {
      const results = [ok(1), err(new Error('failed')), ok(3)]
      const combined = ResultUtils.all(results)

      expect(combined.isErr()).toBe(true)
      expect(combined.error.message).toBe('failed')
    })

    it('should return first Ok with any', () => {
      const results = [err(new Error('fail1')), ok(42), ok(100)]
      const result = ResultUtils.any(results)

      expect(result.isOk()).toBe(true)
      expect(result.unwrap()).toBe(42)
    })

    it('should return last error with any when all fail', () => {
      const results = [err(new Error('fail1')), err(new Error('fail2'))]
      const result = ResultUtils.any(results)

      expect(result.isErr()).toBe(true)
      expect(result.error.message).toBe('fail2')
    })
  })
})

describe('PackageURL Result methods', () => {
  describe('tryFromString', () => {
    it('should return Ok for valid purl string', () => {
      const result = PackageURL.tryFromString('pkg:npm/lodash@4.17.21')

      expect(result.isOk()).toBe(true)
      const purl = result.unwrap()
      expect(purl.type).toBe('npm')
      expect(purl.name).toBe('lodash')
      expect(purl.version).toBe('4.17.21')
    })

    it('should return Err for invalid purl string', () => {
      const result = PackageURL.tryFromString('invalid-purl')

      expect(result.isErr()).toBe(true)
      expect(result.error).toBeInstanceOf(Error)
    })

    it('should return Err for non-string input', () => {
      const result = PackageURL.tryFromString(123)

      expect(result.isErr()).toBe(true)
      expect(result.error.message).toContain('purl string argument is required')
    })
  })

  describe('tryFromObject', () => {
    it('should return Ok for valid object', () => {
      const obj = { type: 'npm', name: 'lodash', version: '4.17.21' }
      const result = PackageURL.tryFromObject(obj)

      expect(result.isOk()).toBe(true)
      const purl = result.unwrap()
      expect(purl.type).toBe('npm')
      expect(purl.name).toBe('lodash')
      expect(purl.version).toBe('4.17.21')
    })

    it('should return Err for invalid object', () => {
      const obj = { type: '', name: 'lodash' }
      const result = PackageURL.tryFromObject(obj)

      expect(result.isErr()).toBe(true)
      expect(result.error).toBeInstanceOf(Error)
    })

    it('should return Err for non-object input', () => {
      const result = PackageURL.tryFromObject('not an object')

      expect(result.isErr()).toBe(true)
      expect(result.error.message).toContain('Object argument is required')
    })
  })

  describe('tryFromJSON', () => {
    it('should return Ok for valid JSON', () => {
      const json = '{"type":"npm","name":"lodash","version":"4.17.21"}'
      const result = PackageURL.tryFromJSON(json)

      expect(result.isOk()).toBe(true)
      const purl = result.unwrap()
      expect(purl.type).toBe('npm')
      expect(purl.name).toBe('lodash')
      expect(purl.version).toBe('4.17.21')
    })

    it('should return Err for invalid JSON', () => {
      const result = PackageURL.tryFromJSON('invalid json')

      expect(result.isErr()).toBe(true)
      expect(result.error.message).toContain('Invalid JSON string')
    })

    it('should return Err for non-string input', () => {
      const result = PackageURL.tryFromJSON(123)

      expect(result.isErr()).toBe(true)
      expect(result.error.message).toContain('JSON string argument is required')
    })

    it('should return Err for valid JSON with invalid purl data', () => {
      const json = '{"type":"","name":"lodash"}'
      const result = PackageURL.tryFromJSON(json)

      expect(result.isErr()).toBe(true)
      expect(result.error).toBeInstanceOf(Error)
    })
  })

  describe('tryParseString', () => {
    it('should return Ok for valid purl string', () => {
      const result = PackageURL.tryParseString('pkg:npm/lodash@4.17.21')

      expect(result.isOk()).toBe(true)
      const components = result.unwrap()
      expect(components).toHaveLength(6)
      // type
      expect(components[0]).toBe('npm')
      // name
      expect(components[2]).toBe('lodash')
      // version
      expect(components[3]).toBe('4.17.21')
    })

    it('should return Err for invalid purl string', () => {
      const result = PackageURL.tryParseString('invalid-purl')

      expect(result.isErr()).toBe(true)
      expect(result.error).toBeInstanceOf(Error)
    })

    it('should return Err for non-string input', () => {
      const result = PackageURL.tryParseString(null)

      expect(result.isErr()).toBe(true)
      expect(result.error.message).toContain('purl string argument is required')
    })
  })

  describe('functional composition', () => {
    it('should chain operations with map and andThen', () => {
      const result = PackageURL.tryFromString('pkg:npm/lodash@4.17.21')
        .map(purl => ({ purl, isNpm: purl.type === 'npm' }))
        .andThen(({ isNpm, purl }) =>
          isNpm ? ok(purl.name) : err(new Error('Not an npm package')),
        )

      expect(result.isOk()).toBe(true)
      expect(result.unwrap()).toBe('lodash')
    })

    it('should handle error propagation', () => {
      const result = PackageURL.tryFromString('invalid-purl')
        .map(purl => purl.name)
        .andThen(name => ok(name.toUpperCase()))

      expect(result.isErr()).toBe(true)
    })

    it('should provide fallbacks with orElse', () => {
      const result = PackageURL.tryFromString('invalid-purl').orElse(() =>
        PackageURL.tryFromString('pkg:npm/fallback@1.0.0'),
      )

      expect(result.isOk()).toBe(true)
      expect(result.unwrap().name).toBe('fallback')
    })

    it('should work with unwrapOr for defaults', () => {
      const validPurl = PackageURL.tryFromString(
        'pkg:npm/lodash@4.17.21',
      ).unwrapOr(
        new PackageURL(
          'npm',
          undefined,
          'default',
          '1.0.0',
          undefined,
          undefined,
        ),
      )

      expect(validPurl.name).toBe('lodash')

      const invalidPurl = PackageURL.tryFromString('invalid-purl').unwrapOr(
        new PackageURL(
          'npm',
          undefined,
          'default',
          '1.0.0',
          undefined,
          undefined,
        ),
      )

      expect(invalidPurl.name).toBe('default')
    })
  })
})
