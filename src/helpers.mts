/**
 * @file Helper function for creating namespace objects. Organizes helper
 *   functions by property names with configurable defaults and sorting.
 */
import {
  ArrayPrototypeFlatMap,
  ArrayPrototypeToSorted,
  ObjectCreate,
  ObjectKeys,
  ObjectValues,
  SetCtor,
} from '@socketsecurity/lib/primordials'

/**
 * Create namespace object organizing helpers by property names.
 */
export function createHelpersNamespaceObject(
  helpers: Record<string, Record<string, unknown>>,
  options_: Record<string, unknown> = {},
): Record<string, Record<string, unknown>> {
  const { comparator, ...defaults } = {
    __proto__: null,
    ...options_,
  } as Record<string, unknown> & {
    comparator?: ((_a: string, _b: string) => number) | undefined
  }
  const helperNames = ArrayPrototypeToSorted(ObjectKeys(helpers))
  // Collect all unique property names from all helper objects
  const propNames = ArrayPrototypeToSorted(
    [
      ...new SetCtor(
        ArrayPrototypeFlatMap(
          ObjectValues(helpers),
          (helper: Record<string, unknown>) => ObjectKeys(helper),
        ),
      ),
    ],
    comparator,
  )
  // oxlint-disable-next-line socket/prefer-undefined-over-null -- Object.create(null) / Reflect.setPrototypeOf(_, null) require the null sentinel.
  const nsObject: Record<string, Record<string, unknown>> = ObjectCreate(null)
  // Build inverted structure: property -> {helper1: value1, helper2: value2}
  for (let i = 0, { length } = propNames; i < length; i += 1) {
    const propName = propNames[i]!
    // oxlint-disable-next-line socket/prefer-undefined-over-null -- Object.create(null) / Reflect.setPrototypeOf(_, null) require the null sentinel.
    const helpersForProp: Record<string, unknown> = ObjectCreate(null)
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
