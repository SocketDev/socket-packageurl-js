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
 * @file Standalone implementations of `PackageURL` static factory/utility
 *   methods. Extracted to keep `package-url.mts` under the 500-line soft cap.
 *   Methods that construct a `PackageURL` instance receive the class via a
 *   lazy registration call (`registerPackageURLStatics`) to avoid circular
 *   imports.
 */

import { isObject, recursiveFreeze } from './objects.mjs'
import { ArrayIsArray } from '@socketsecurity/lib/primordials/array'
import { BufferByteLength } from '@socketsecurity/lib/primordials/buffer'
import {
  ErrorCtor,
  SyntaxErrorCtor,
} from '@socketsecurity/lib/primordials/error'
import { JSONParse } from '@socketsecurity/lib/primordials/json'
import { MapCtor } from '@socketsecurity/lib/primordials/map-set'
import { parseString } from './package-url-parse.mjs'
import { parseNpmSpecifier } from './purl-types/npm.mjs'
import { ResultUtils } from './result.mjs'
import { UrlConverter } from './url-converter.mjs'

import type { PackageURL, PackageURLObject } from './package-url.mjs'
import type { ParsedPurlComponents } from './package-url.mjs'
import type { Result } from './result.mjs'

// Lazy reference to `PackageURL`, set by `package-url.mts` at module load time
// to avoid circular import issues.
let cachedPackageURL: typeof PackageURL | undefined

// LRU flyweight cache for `fromString` — avoids re-parsing identical PURL
// strings. Bounded to prevent memory leaks.
const FLYWEIGHT_CACHE_MAX = 1024
export const flyweightCache = new MapCtor<string, PackageURL>()

/**
 * Create `PackageURL` from JSON string.
 */
export function fromJSON(json: unknown): PackageURL {
  if (typeof json !== 'string') {
    throw new ErrorCtor('JSON string argument is required.')
  }

  // Size limit: 1MB to prevent memory exhaustion
  // Check actual byte size, not character length
  const MAX_JSON_SIZE = 1024 * 1024
  const byteSize = BufferByteLength!(json, 'utf8')
  if (byteSize > MAX_JSON_SIZE) {
    throw new ErrorCtor(
      `JSON string exceeds maximum size limit of ${MAX_JSON_SIZE} bytes`,
    )
  }

  let parsed: unknown
  try {
    parsed = JSONParse(json)
  } catch (e) {
    // For JSON parsing errors, throw a SyntaxError with the expected message
    throw new SyntaxErrorCtor('Failed to parse PackageURL from JSON', {
      cause: e,
    })
  }

  // Validate parsed result is an object
  if (!parsed || typeof parsed !== 'object' || ArrayIsArray(parsed)) {
    throw new ErrorCtor('JSON must parse to an object.')
  }

  // Cast to record type for safe property access
  const parsedRecord = parsed as Record<string, unknown>

  // Create a safe object without prototype chain to prevent prototype pollution
  const safeObject: PackageURLObject = {
    __proto__: null,
    type: parsedRecord['type'] as string | undefined,
    namespace: parsedRecord['namespace'] as string | undefined,
    name: parsedRecord['name'] as string | undefined,
    version: parsedRecord['version'] as string | undefined,
    qualifiers: parsedRecord['qualifiers'] as
      | Record<string, string>
      | undefined,
    subpath: parsedRecord['subpath'] as string | undefined,
  } as PackageURLObject

  return fromObject(safeObject)
}

export function fromNpm(specifier: unknown): PackageURL {
  const PackageURL = cachedPackageURL!
  const { name, namespace, version } = parseNpmSpecifier(specifier)
  return new PackageURL('npm', namespace, name, version, undefined, undefined)
}

export function fromObject(obj: unknown): PackageURL {
  const PackageURL = cachedPackageURL!
  if (!isObject(obj)) {
    throw new ErrorCtor('Object argument is required.')
  }
  const typedObj = obj as Record<string, unknown>
  return new PackageURL(
    typedObj['type'],
    typedObj['namespace'],
    typedObj['name'],
    typedObj['version'],
    typedObj['qualifiers'],
    typedObj['subpath'],
  )
}

export function fromSpec(type: string, specifier: unknown): PackageURL {
  const PackageURL = cachedPackageURL!
  switch (type) {
    case 'npm': {
      const { name, namespace, version } = parseNpmSpecifier(specifier)
      return new PackageURL(
        'npm',
        namespace,
        name,
        version,
        undefined,
        undefined,
      )
    }
    default:
      throw new ErrorCtor(
        `Unsupported package type: ${type}. Currently supported: npm`,
      )
  }
}

export function fromString(purlStr: unknown): PackageURL {
  const PackageURL = cachedPackageURL!
  if (typeof purlStr === 'string') {
    const cached = flyweightCache.get(purlStr)
    if (cached !== undefined) {
      flyweightCache.delete(purlStr)
      flyweightCache.set(purlStr, cached)
      return cached
    }
  }
  const purl = new PackageURL(...parseString(purlStr))
  purl.toString()
  recursiveFreeze(purl)
  if (typeof purlStr === 'string') {
    if (flyweightCache.size >= FLYWEIGHT_CACHE_MAX) {
      // Evict oldest entry (`Map` iteration order is insertion order).
      // `size >= MAX` (a positive constant) guarantees a first key, so the
      // iterator result is never `undefined` here.
      flyweightCache.delete(flyweightCache.keys().next().value!)
    }
    flyweightCache.set(purlStr, purl)
  }
  return purl
}

export function fromUrl(urlStr: string): PackageURL | undefined {
  return UrlConverter.fromUrl(urlStr)
}

export function isValid(purlStr: unknown): boolean {
  return tryFromString(purlStr).isOk()
}

export function registerPackageURLStatics(ctor: typeof PackageURL): void {
  cachedPackageURL = ctor
}

export { parseString }
export type { ParsedPurlComponents }

export function tryFromJSON(json: unknown): Result<PackageURL> {
  return ResultUtils.from(() => fromJSON(json))
}

export function tryFromObject(obj: unknown): Result<PackageURL> {
  return ResultUtils.from(() => fromObject(obj))
}

export function tryFromString(purlStr: unknown): Result<PackageURL> {
  return ResultUtils.from(() => fromString(purlStr))
}

export function tryParseString(purlStr: unknown): Result<unknown[]> {
  return ResultUtils.from(() => parseString(purlStr))
}
