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
    comparator?: ((_a: string, _b: string) => number) | undefined
  }
  const helperNames = Object.keys(helpers).sort()
  // Collect all unique property names from all helper objects
  const propNames = [
    ...new Set(
      Object.values(helpers).flatMap((helper: Record<string, unknown>) =>
        Object.keys(helper),
      ),
    ),
  ].sort(comparator)
  const nsObject: Record<string, Record<string, unknown>> = Object.create(null)
  // Build inverted structure: property -> {helper1: value1, helper2: value2}
  for (let i = 0, { length } = propNames; i < length; i += 1) {
    const propName = propNames[i]!
    const helpersForProp: Record<string, unknown> = Object.create(null)
    for (
      let j = 0, { length: helperNamesLength } = helperNames;
      j < helperNamesLength;
      j += 1
    ) {
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
