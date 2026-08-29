/*
 * @file Names the builtins that cannot be loaded while `node --build-snapshot`
 *   runs, and finds them in a built snapshot pack.
 *
 *   A builtin backed by a native binding registers an external reference V8
 *   cannot serialize, so requiring one at module scope in a snapshot builder
 *   script aborts the build with "Unknown external reference 0x… /
 *   <unresolved>" and exit 133. That message names neither the module nor the
 *   hook that pulled it in, which is the whole problem: the pack is a 2.9 MB
 *   bundle, so the abort points at nothing readable.
 *
 *   The escape is `process.getBuiltinModule('node:x')` called INSIDE a function,
 *   so the builtin is resolved after deserialization rather than during the
 *   build, or `@dispatch-snapshot-exclude` on a hook that genuinely needs the
 *   module at load time.
 */

// The list lives with the guard and the lint rule that read it at WRITE time,
// so those two surfaces and this build-time reporter can never disagree about
// which builtin is hostile.
import { SNAPSHOT_HOSTILE_BUILTINS } from '../../../.claude/hooks/fleet/_shared/snapshot-hostile-builtins.mts'

export { SNAPSHOT_HOSTILE_BUILTINS } from '../../../.claude/hooks/fleet/_shared/snapshot-hostile-builtins.mts'

/**
 * The snapshot-hostile builtins a built pack requires, in listed order.
 */
export function findSnapshotHostileRequires(packText: string): string[] {
  const found: string[] = []
  for (let i = 0, { length } = SNAPSHOT_HOSTILE_BUILTINS; i < length; i += 1) {
    const builtin = SNAPSHOT_HOSTILE_BUILTINS[i]!
    // The pack is bundled CJS, so the specifier survives as a quoted literal.
    const pattern = new RegExp(`require\\(\\s*['"]${builtin}['"]\\s*\\)`)
    if (pattern.test(packText)) {
      found.push(builtin)
    }
  }
  return found
}
