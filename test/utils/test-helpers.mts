/**
 * @fileoverview Test helper utilities for creating test functions and data
 */

import { PackageURL } from '../../src/package-url.js'

import type { TtlCache } from '@socketsecurity/lib/cache-with-ttl'

/**
 * Create a test function with optional return value.
 * @param returnValue - Optional value to return from the function
 */
export function createTestFunction(
  returnValue?: string,
): () => string | undefined {
  if (returnValue !== undefined) {
    return () => returnValue
  }
  return () => undefined
}

/**
 * Create a PackageURL with simplified parameters.
 * @param type - Package type
 * @param name - Package name
 * @param opts - Optional parameters
 */
export function createTestPurl(
  type: string,
  name: string,
  opts?: {
    namespace?: string | null
    qualifiers?: Record<string, string> | null
    subpath?: string
    version?: string
  },
): PackageURL {
  return new PackageURL(
    type,
    opts?.namespace,
    name,
    opts?.version,
    opts?.qualifiers,
    opts?.subpath,
  )
}

/**
 * Create a minimal mock TtlCache for testing.
 * Only implements get/set methods backed by a Map.
 */
export function createMockCache(): TtlCache {
  const cacheData = new Map<string, unknown>()
  return {
    async get<T>(key: string): Promise<T | undefined> {
      return cacheData.get(key) as T | undefined
    },
    async set<T>(key: string, value: T): Promise<void> {
      cacheData.set(key, value)
    },
    async getAll<T>(_pattern: string): Promise<Map<string, T>> {
      return new Map(cacheData) as Map<string, T>
    },
    async getOrFetch<T>(key: string, fetchFn: () => Promise<T>): Promise<T> {
      const cached = cacheData.get(key) as T | undefined
      if (cached !== undefined) {
        return cached
      }
      const value = await fetchFn()
      cacheData.set(key, value)
      return value
    },
    async delete(key: string): Promise<void> {
      cacheData.delete(key)
    },
    async deleteAll(_pattern?: string): Promise<number> {
      const size = cacheData.size
      cacheData.clear()
      return size
    },
    async clear(): Promise<void> {
      cacheData.clear()
    },
  } as TtlCache
}
