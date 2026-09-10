import type { TtlCache } from '@socketsecurity/lib/cache/ttl/types'

/**
 * Create a minimal mock TtlCache for testing. Only implements get/set methods
 * backed by a Map.
 */
export function createMockCache(): TtlCache {
  const cacheData = new Map<string, unknown>()
  return {
    async get<T>(key: string): Promise<T | undefined> {
      return cacheData.get(key) as T | undefined
    },
    async set(key: string, value: unknown): Promise<void> {
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
    async deleteAll(_pattern?: string | undefined): Promise<number> {
      const size = cacheData.size
      cacheData.clear()
      return size
    },
    async clear(): Promise<void> {
      cacheData.clear()
    },
  }
}
