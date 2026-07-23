/**
 * @file Object utility functions for type checking and immutable object
 *   creation. Provides object validation and recursive freezing utilities.
 */

import { LOOP_SENTINEL } from './constants.mjs'
import { ArrayIsArray } from '@socketsecurity/lib/primordials/array'
import { ErrorCtor } from '@socketsecurity/lib/primordials/error'
import { WeakSetCtor } from '@socketsecurity/lib/primordials/map-set'
import {
  ObjectFreeze,
  ObjectIsFrozen,
} from '@socketsecurity/lib/primordials/object'
import { ReflectOwnKeys } from '@socketsecurity/lib/primordials/reflect'

/**
 * Check if value is a non-null object. Inlined to avoid importing
 * `@socketsecurity/lib/objects` which transitively pulls in `sorts` → `semver`
 * → `npm-pack` (2.5 MB).
 */
export function isObject(
  value: unknown,
): value is { [key: PropertyKey]: unknown } {
  return value !== null && typeof value === 'object'
}

/**
 * Recursively freeze an object and all nested objects. Uses breadth-first
 * traversal with a queue for memory efficiency.
 *
 * @throws {Error} When object graph too large or circular reference detected.
 */
export function recursiveFreeze<T>(value_: T): T {
  if (
    value_ === null ||
    !(typeof value_ === 'object' || typeof value_ === 'function') ||
    ObjectIsFrozen(value_)
  ) {
    return value_
  }
  // Use breadth-first traversal to avoid stack overflow on deep objects
  const queue = [value_]
  const visited = new WeakSetCtor<object>()
  visited.add(value_)
  let { length: queueLength } = queue
  let pos = 0
  while (pos < queueLength) {
    // Safety check to prevent processing excessively large object graphs
    if (pos === LOOP_SENTINEL) {
      throw new ErrorCtor('Object graph too large (exceeds 1,000,000 items).')
    }
    const obj = queue[pos++]!
    ObjectFreeze(obj)
    if (ArrayIsArray(obj)) {
      // Queue unfrozen array items for processing
      for (let i = 0, { length } = obj; i < length; i += 1) {
        const item: unknown = obj[i]
        if (
          item !== null &&
          (typeof item === 'object' || typeof item === 'function') &&
          !ObjectIsFrozen(item) &&
          !visited.has(item)
        ) {
          visited.add(item)
          queue[queueLength++] = item as T & object
        }
      }
    } else {
      // Queue unfrozen object properties for processing
      const keys = ReflectOwnKeys(obj)
      for (let i = 0, { length } = keys; i < length; i += 1) {
        const propValue: unknown = (obj as Record<PropertyKey, unknown>)[
          keys[i]!
        ]
        if (
          propValue !== null &&
          (typeof propValue === 'object' || typeof propValue === 'function') &&
          !ObjectIsFrozen(propValue) &&
          !visited.has(propValue)
        ) {
          visited.add(propValue)
          queue[queueLength++] = propValue as T & object
        }
      }
    }
  }
  return value_
}
