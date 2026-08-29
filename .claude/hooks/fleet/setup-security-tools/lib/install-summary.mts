/**
 * @file The summary block and exit code every setup-* installer leaf prints.
 *   Four leaves ran the same shape by hand: await a set of installers, print
 *   one `Label: ready` line each, exit 1 if any failed. Hand-copied, the exit
 *   arm is the piece that rots — a leaf that prints FAILED and still exits 0 is
 *   a false green, and the operator only learns the tool is missing when
 *   something else fails much later.
 *   Both functions are pure over their outcomes, so the contract is testable
 *   without installing anything.
 */

import { sortedByString } from '../../_shared/sorted-by.mts'

export interface ToolOutcome {
  /**
   * Name as the operator reads it, e.g. `TruffleHog`.
   */
  readonly label: string
  readonly ok: boolean
  /**
   * Wording when `ok` is false. Defaults to `FAILED`; a tool that is optional
   * on some platforms says `NOT AVAILABLE` instead, which is a different claim
   * and must not be flattened into failure text.
   */
  readonly failText?: string | undefined
}

export const READY_TEXT = 'ready'
export const DEFAULT_FAIL_TEXT = 'FAILED'

/**
 * The status word for one outcome.
 */
export function statusText(outcome: ToolOutcome): string {
  if (outcome.ok) {
    return READY_TEXT
  }
  return outcome.failText ?? DEFAULT_FAIL_TEXT
}

/**
 * The summary lines, label-aligned and sorted by label.
 *
 * Alignment is computed from the widest label rather than hard-coded padding,
 * which is what drifted every time a leaf gained a tool with a longer name.
 * Sorted so the block reads the same on every run: the installers finish in
 * whatever order `Promise.all` settles them.
 */
export function summaryLines(outcomes: readonly ToolOutcome[]): string[] {
  const ordered = sortedByString(outcomes, outcome => outcome.label)
  let widest = 0
  for (let i = 0, { length } = ordered; i < length; i += 1) {
    widest = Math.max(widest, ordered[i]!.label.length)
  }
  return ordered.map(outcome => {
    const gap = ' '.repeat(widest - outcome.label.length)
    return `${outcome.label}:${gap} ${statusText(outcome)}`
  })
}

/**
 * 1 when any tool failed, 0 when every one is ready.
 *
 * An empty set is 0: a leaf with nothing to install has nothing to report as
 * broken, and failing there would block a platform that legitimately skips.
 */
export function installExitCode(outcomes: readonly ToolOutcome[]): number {
  for (let i = 0, { length } = outcomes; i < length; i += 1) {
    if (!outcomes[i]!.ok) {
      return 1
    }
  }
  return 0
}
