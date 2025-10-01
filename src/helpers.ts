/**
 * @fileoverview Helper function for creating namespace objects.
 * Organizes helper functions by property names with configurable defaults and sorting.
 */

/**
 * Create namespace object organizing helpers by property names.
 */
function createHelpersNamespaceObject(
  helpers: Record<string, Record<string, unknown>>,
  options_: Record<string, unknown> = {},
): Record<string, Record<string, unknown>> {
  const { comparator, ...defaults } = {
    __proto__: null,
    ...options_,
  } as Record<string, unknown> & {
    comparator?: (_a: string, _b: string) => number
  }
  const helperNames = Object.keys(helpers).sort()
  const propNames = [
    ...new Set(
      Object.values(helpers).flatMap((h: Record<string, unknown>) =>
        Object.keys(h),
      ),
    ),
  ].sort(comparator)
  const nsObject: Record<string, Record<string, unknown>> = Object.create(null)
  for (let i = 0, { length } = propNames; i < length; i += 1) {
    const propName = propNames[i]!
    const helpersForProp: Record<string, unknown> = Object.create(null)
    for (let j = 0, { length: length_j } = helperNames; j < length_j; j += 1) {
      const helperName = helperNames[j]!
      const helperValue =
        helpers[helperName]?.[propName] ?? defaults[helperName]
      if (helperValue !== undefined) {
        helpersForProp[helperName] = helperValue
      }
    }
    nsObject[propName] = helpersForProp
  }
  return nsObject
}

export { createHelpersNamespaceObject }
