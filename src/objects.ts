/**
 * @fileoverview Object utility functions for type checking and immutable object creation.
 * Provides object validation and recursive freezing utilities.
 */
 
import { isObject } from '@socketsecurity/lib/objects'

import { LOOP_SENTINEL } from './constants.js'

/**
 * Recursively freeze an object and all nested objects.
 * Uses breadth-first traversal with a queue for memory efficiency.
 * @throws {Error} When object graph too large or circular reference detected.
 */
function recursiveFreeze<T>(value_: T): T {
  if (
    value_ === null ||
    !(typeof value_ === 'object' || typeof value_ === 'function') ||
    Object.isFrozen(value_)
  ) {
    return value_
  }
  // Use breadth-first traversal to avoid stack overflow on deep objects
  const queue = [value_ as T & object]
  const visited = new WeakSet<object>()
  visited.add(value_ as T & object)
  let { length: queueLength } = queue
  let pos = 0
  while (pos < queueLength) {
    // Safety check to prevent processing excessively large object graphs
    if (pos === LOOP_SENTINEL) {
      throw new Error('Object graph too large (exceeds 1,000,000 items).')
    }
    const obj = queue[pos++]!
    Object.freeze(obj)
    if (Array.isArray(obj)) {
      // Queue unfrozen array items for processing
      for (let i = 0, { length } = obj; i < length; i += 1) {
        const item: unknown = obj[i]
        if (
          item !== null &&
          (typeof item === 'object' || typeof item === 'function') &&
          !Object.isFrozen(item) &&
          !visited.has(item as object)
        ) {
          visited.add(item as object)
          queue[queueLength++] = item as T & object
        }
      }
    } else {
      // Queue unfrozen object properties for processing
      const keys = Reflect.ownKeys(obj)
      for (let i = 0, { length } = keys; i < length; i += 1) {
        const propValue: unknown = (obj as Record<PropertyKey, unknown>)[
          keys[i]!
        ]
        if (
          propValue !== null &&
          (typeof propValue === 'object' || typeof propValue === 'function') &&
          !Object.isFrozen(propValue) &&
          !visited.has(propValue as object)
        ) {
          visited.add(propValue as object)
          queue[queueLength++] = propValue as T & object
        }
      }
    }
  }
  return value_
}

export { isObject, recursiveFreeze }
